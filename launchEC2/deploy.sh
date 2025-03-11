#!/bin/bash
STAGE=$1
REGION=$2
[ -z "$STAGE" ] && STAGE=dev
[ -z "$REGION" ] && REGION=us-west-2
echo serverless deploy --stage $STAGE --region $REGION
serverless deploy --stage $STAGE --region $REGION
