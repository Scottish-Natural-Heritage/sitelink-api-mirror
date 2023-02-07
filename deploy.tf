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
