# Tell terraform where to keep it's state between runs so it can be run
# locally as well as on ci/cd
terraform {
  backend "s3" {
    bucket = "naturescot-sitelink-mirror-state"
    key    = "terraform-state"
    region = "eu-west-2"
  }
}

# Tell terraform where in the world to spin up our resources
provider "aws" {
  region = "eu-west-2"
}

# Some things like CloudFront are global, so need some resources created
# in the primary US region
provider "aws" {
  region = "us-east-1"
  alias  = "alternate"
}

# Read our CloudFlare API Token from the calling shell's environment
variable "cloudflare_api_token" {
  type = string
}

# Cloudflare is used for our DNS certificate validation and also for our
# final service name
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# Create an S3 bucket for storing our files
resource "aws_s3_bucket" "bucket" {
  bucket = "naturescot-sitelink-mirror"
}

# Configure the web serving from S3
resource "aws_s3_bucket_website_configuration" "website" {
  bucket = aws_s3_bucket.bucket.bucket

  index_document {
    suffix = "index.json"
  }
}

# Allow GET requests from anywhere
resource "aws_s3_bucket_cors_configuration" "cors" {
  bucket = aws_s3_bucket.bucket.bucket

  cors_rule {
    allowed_methods = ["GET"]
    allowed_origins = ["*"]
  }
}

# Upload all the JSON files to S3
resource "aws_s3_object" "content" {
  for_each = fileset("mirror", "**/*.json")

  bucket       = aws_s3_bucket.bucket.bucket
  key          = each.key
  source       = "${path.module}/mirror/${each.key}"
  content_type = "application/json"
  etag         = filemd5("${path.module}/mirror/${each.key}")

  acl = "public-read"
}

# Create a NatureScot certificate
resource "aws_acm_certificate" "certificate" {
  domain_name       = "sitelink-api.nature.scot"
  validation_method = "DNS"
  provider          = aws.alternate
}

# Find the nature.scot zone in Cloudflare
data "cloudflare_zones" "nature_scot" {
  filter {
    name = "nature.scot"
  }
}

# Create a DNS record for each validation request from ACM
resource "cloudflare_record" "validation_records" {
  # Each name & alias could result in a validation request, so we
  # 'for each' this block
  for_each = { for record in aws_acm_certificate.certificate.domain_validation_options : record.resource_record_name => record }
  zone_id  = data.cloudflare_zones.nature_scot.zones[0].id
  name     = each.value.resource_record_name
  value    = each.value.resource_record_value
  type     = each.value.resource_record_type
  ttl      = 300
}

# Wait until the DNS records have been created and ACM has verified them
resource "aws_acm_certificate_validation" "validation" {
  certificate_arn = aws_acm_certificate.certificate.arn
  validation_record_fqdns = [
    for record in aws_acm_certificate.certificate.domain_validation_options : cloudflare_record.validation_records[record.resource_record_name].name
  ]
  provider = aws.alternate
}

# We want to use a pre-baked CORS response to allow folks to call our
# API from anywhere, for pretty much any use
data "aws_cloudfront_response_headers_policy" "cors_preflight_security_headers" {
  name = "Managed-CORS-with-preflight-and-SecurityHeadersPolicy"
}

# Wrap the S3 bucket with an HTTPS CDN distribution
resource "aws_cloudfront_distribution" "distribution" {

  aliases = ["sitelink-api.nature.scot"]

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "sitelink-api-mirror"
    viewer_protocol_policy     = "redirect-to-https"
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.cors_preflight_security_headers.id
    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }
  }

  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"

  # The values in this block, particularly those in the custom config
  # were found by reverse engineering an exising CloudFront distribution
  # set to target an S3 bucket's website endpoint rather than the bucket
  # directly. This way we can serve index.json files through CloudFront
  # rather than index.html files.
  origin {
    connection_attempts = 3
    connection_timeout  = 10
    domain_name         = aws_s3_bucket_website_configuration.website.website_endpoint
    origin_id           = "sitelink-api-mirror"

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_keepalive_timeout = 5
      origin_protocol_policy   = "http-only"
      origin_read_timeout      = 30
      origin_ssl_protocols = [
        "TLSv1.2",
      ]
    }
  }

  price_class = "PriceClass_100"

  restrictions {
    geo_restriction {
      locations        = []
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.certificate.arn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }
}
