# launch-ec2
Use lambda to create an ec2 and execute code in the ec2, then terminate the ec2.

The samples in this repository are written in nodejs (javascript) and use 
serverless framework for deployment.

s3unzip is a lambda that accepts an s3 bucket and the name of a zip file 
in that bucket. It unzips the file into a new folder in the bucket whose 
name is like the zip file without '.zip' suffix.

If the operation takes too long, configurable in serverless.yml, 
s3unzip invokes launchEC2 lambda, passing to it a (bash) script, and an IAM 
role. The lambda creates a micro EC2 that has the permissions specified by 
the role, and passes it the script. The EC2 executes the script, and when 
done it terminates it self.

launchEC2 is a generic lambda. Some restrictions and conventions:
* It is designed to run in a private subnet, and has outbound access via a 
NAT gateway.
* It will not work in a public subnet (one that has an Internet Gateway) 
without modifications
* It launches the EC2 in the same subnets where it can execute. This is by 
design.
* It has read access to an S3 bucket called launchec2. Typically the lambda 
that uses it will have a copy of its code in that bucket, and the script 
will download it to the EC2 and execute it.
* It deployes the EC2 with a keypair called launchEC2. The purpose of this 
key is to allow access to the running EC2 for troubleshooting.


### Configuration and deployment:

AWS environment pre-requisites, per deployment stage (dev or prod)
* Two (or more) private subnets in the region where launchEC2 is 
deployed. Each of the private subnets should have a public subnet counterpart.
* A NAT gateway deployed in each of the public subnets and configured to 
route outbound Internet traffic from its corresponding private subnet. 
* Configuration parameters defined in ssm:
    - region : idendifies the region of the deployment.  
    - PrivateSubnetIdA, PrivateSubnetIdB : the subnets of the deployment
    - PrivateSubnetsSGId : the security group for the subnets

launchEC2 pre-requisites, per deployment stage (dev or prod)
* launchEC2Policy : added to the IAM role passed to launchEC2 lambda
* s3bucket : used to transfer program code from lambda to EC2

s3unzip pre-requisites, per deployment stage (dev or prod)
* s3unzipPolicy : added to the IAM role passed to launchEC2 lambda
* s3unzip-ec2Role : the role passed to launchEC2 lambda
* s3bucket : holds zip files to be procssed

The following steps will set up a network configuration for the development 
environment ('dev') in a region. Repeat the same step replacing 'dev' with 
'prod' for the production environment. 

#### Tagging pre-existing public subnets:

The default VPC has multiple public networks. In AWS management console, 
you can verify that by navigating to VPC / Seubnets. Select a subnet, 
select Route Table.
Note that the id of target of the route for 0.0.0.0/0 starts with igw-.
That is the subnet's Internet Gateway, which allows inboud traffic to
the subnet, thus defining it as a public subnet.

For each of the listed subnets go to Details, copy the subnet availability
zone id, click the name field in the subnets list and set its name to
public-&lt;availability zone id&gt;. 

Notice we use the "Name" field as a tag to identify the type of subnet
and the availability zone it resides in, not as a unique name.


#### About subnets:

In Your VPCs, note the CIDR of the VPC. typically 172.nn.0.0/16. 
This indicates the VPC has 65536 (32-16) ip addresses.
In Subnets, not the CIDR of the subnets, typically 172.nn.mm.0/20.
This indicates each subnet has 4096 (32-20) ip addresses. Note the
increment in CIDR values between subnets: 172.nn.0.0, 172.nn.16.0....
Note the highest value.


#### Create private subnets:

* In AWS management console, navigate to VPC / Subnets
 1. Click Create Subnet
 2. Select the default VPC
 3. Skip the name field and first select an availability zone.
    Note the availability zone id (ends with azN, N is a digit).
 4. Name the subnet as private-&lt;availability zone id&gt; 
 5. Choose a subnet CIDR block. This field is not very intuitive;
    Enter the CIDR of one of the existing subnets, then use the arrows 
    to find the first unused range.
 6. Click Create Subnet.
 7. Note the id of the private subnet you created (subnet- prefix)
* Repeat these steps to create a second private subnet in a different
  availability zone.
* Navigate back to VPCs / Subnets, and verify the new subnets are listed

At this point the subnets are connected to an Internet Gateway, so in
fact they are are "public".
In the next step, you create NAT Gatways and attach them to the subnets,
replacing the Internet Gateway, which turns them into "private" subnets.


#### About NAT Gateways:

NAT Gateway provides Internet outbound access for lambda and EC2 residing
in a private subnet. The private subnet default route targets the NAT gateway. 
The NAT gateway itself resides in a public subnet so it can reach the Internet 
via the VPC's Internet Gateway.


#### Create NAT Gateways:

* In AWS management console, navigate to VPC / NAT Gateways
 1. Click Create NAT Gateway
 2. Skip the name field and select a **public** subnet in the availability
    zone of your first **private** subnet
 3. Name it as nat-for-private-&lt;availability zone id&gt;
 4. Leave Connectivity type as "public"
 5. Allocate Elastic IP address 
 6. Click Create NAT Gatway
* Repeat these steps for the second private subnet.

To connect the private subnet to its NAT Gatway
* In AWS management console, navigate to VPC / Route tables
 1. Click Create route table 
 2. Name it egress-&lt;availability zone id&gt; of first private subnet az
 3. Click Create route table 
 4. Click Edit routes
 5. Click Add route
 5. Select destination 0.0.0.0/0
 6. Select target the first NAT Gateway you just created
 7. Click Save changes
 8. In Subnet associations, click Edit subnet associations
 9. Select the first private network, and click Save associations
* Repeat for the second NAT Gateway and private subnet


#### Obtain the default Security Group Id

A Security group is needed to run Lambda and EC2 in a specific subnet.
This setup uses the default Security Group

* In AWS management console, navigate to EC2 / Security Groups.
 - Scroll down the list and note the Security group ID of the 
   Security group named default.


#### Create a Key pair:
* In AWS management console, navigate to EC2 / Key Pairs
 1. Click Create Keypair
 2. In the name field enter launchEC2-keypair-dev
 3. Click Create key pair
* The key pair's public key is downloaded automatically. 
  Save it in parameter store as secure string under 
  /deployment/dev/launchEC2-keypair-dev

#### Create SSM parameters:

These SSM parameters enable services deployment configuration that is 
independent of the region and environment they are deployed in.

* In AWS management console, navigate to AWS Systems Manager/ Parameter Store
 1. Click Create parameter
 2. In Name field enter /deployment/dev/region
 3. In Value field enter the region for example: eu-central-1
 4. Click Create parameter
* Repeat for these other parameters:
 - /deployment/dev/PrivateSubnetIdA &lt;first private subnet id&gt;
 - /deployment/dev/PrivateSubnetIdB &lt;second private subnet id&gt;
 - /deployment/dev/PrivateSubnetsSGId &lt;default security group&gt;


#### Create S3 buckets:
* In AWS management console, navigate to Amazon S3 / buckets
 1. Click Create Bucket
 2. Enter bucket name launchec2-dev, leave other settings unchanged
 3. Click Create Bucket
* Repeat these steps for s3unzip-dev


#### Create policies:
* In AWS management console, navigate to IAM / Policies 
 1. Click Create Policy, click JSON button
 2. Replace the json statement with the content of the file 
    launchEC2/launchEC2Policy-dev.json
 3. Click next
 4. Enter policy name launchEC2Policy-dev
 5. Click Create Policy
* Repeat these steps for s3unzip/s3unzipPolicy-dev.json


#### Create role:
* In AWS management console, navigate to IAM / Roles
 1. Click Create Role, choose AWS service, select EC2 use case / EC2
 2. Click next
 3. Select launchEC2Policy-dev , s3unzipPolicy-dev 
 4. Click next
 5. Enter role name s3unzip-ec2Role-dev
 6. Click create role
 7. On top right, click View Role
 8. Click edit, change Maximum session duration as needed (2 hours)
 9. Click Save changes

#### Deployment

The deployment steps are listed in deploy.sh in this directory.
It should be customized to fit the deployment mechanism.

