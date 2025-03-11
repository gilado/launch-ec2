#!/bin/bash
STAGE=$1
REGION=$2
[ -z "$STAGE" ] && STAGE=dev
[ -z "$REGION" ] && REGION=us-west-2
echo serverless deploy --stage $STAGE --region $REGION
serverless deploy --stage $STAGE --region $REGION
aws s3 cp .serverless/s3unzip.zip s3://launchec2-$STAGE/s3unzip.zip
