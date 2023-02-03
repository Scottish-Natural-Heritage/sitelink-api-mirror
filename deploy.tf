# Tell terraform where to keep it's state between runs so it can be run
# locally as well as on ci/cd
terraform {
  backend "s3" {
    bucket = "naturescot-sitelink-mirror-state"
    key    = "terraform-state"
    region = "eu-west-2"
  }
}
