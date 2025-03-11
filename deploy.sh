#!/bin/bash

REPOSITORY_NAME="launch-ec2" # This repository
REPOITORY_OWNER="<owner>"    # Github account of repository

# Credentials for git user that performs deployments, for example
# username: deployment
# email: deployment@example.org
# access token: stored in git secrets
GITUSERNAME="deployment"
GITUSEREMAIL="deployment@example.org"
GITACCESSTOKEN="<access token>"


# Credentials for deployment AWS account  
AWS_ACCESS_KEY_ID="<aws_access_key_id>"
AWS_SECRET_ACCESS_KEY_ID="<aws_secret_access_key_id>"
AWS_REGION="<region>" # e.g. us-west-2
STAGE="dev" # dev staging or prod


sudo yum update -y
sudo yum install nodejs npm
sudo npm instal -g serverless
sudo yum install git

# Create git access files
echo "[core]
    editor = nano
[credential]
    helper = store
[user]
    name = $GITUSERNAME
    email = $GITUSEREMAIL
[http]
    sslVerify = true
    postBuffer = 524288000" > ~/.gitconfig

echo "https://${GITUSERNAME}:${GITACCESSTOKEN}@github.com" ~/.git-credentials

cd ~

git clone https://github.com/${REPOSITORY_OWNER}/${REPOSITORY_NAME}.git
cd $REPOSITORY_NAME

# Create aws access files
# There should be an aws user that performs deployment. The user need not
# have login access. That user's access key will be used for deployment
# username: deployment
# email: deployment@example.org
# aws_access_key_id: stored in git secrets
# aws_secret_access_key: stored in git secrets
mkdir -p ~/.aws
echo "[default]
aws_access_key_id=$AWS_ACCESS_KEY_ID
aws_secret_access_key=$AWS_SECRET_ACCESS_KEY
region=$AWS_REGION" > ~/.aws/config

# Deploy launchEC2
cd launchEC2
# Install required packages listed in package.json
npm install $(jq -r '.dependencies | to_entries[] | "\(.key)@\(.value)"' package.json)
./deploy.sh $STAGE $AWS_REGION

cd .. # Back to repository root

# Deploy s3unzip
cd s3unzip
# Install required packages listed in package.json
npm install $(jq -r '.dependencies | to_entries[] | "\(.key)@\(.value)"' package.json)
./deploy.sh $STAGE $AWS_REGION

# Clean up
cd ~
rm -rf ${REPOSITORY_NAME}
rm -rf ~/aws
rm -f ~/.gitconfig
rm -f ~/.git-credentials


