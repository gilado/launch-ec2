
const fs = require('fs');
const path = require('path');
const { 
  EC2Client, 
  RunInstancesCommand,
  waitUntilInstanceRunning,
  DescribeInstanceStatusCommand,
} = require('@aws-sdk/client-ec2');

const curTime = require('performance-now'); /* Time in milliseconds */
/* Returns number of seconds since startTime */
const elapsedTime = (startTime) => ((curTime()-startTime)/1000).toFixed(3);

exports.launchEC2 = async (event) => {
  try {  
    console.log("Event: \n" + JSON.stringify(event,null,2));
    const instance = await launchEC2Instance(event.runme,event.role);
    if (!instance)
      throw new Error("Faild to launch EC2");  
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Lambda executed on EC2 successfully' })
    };
  } 
  catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Error executing Lambda on EC2', error })
    };
  }
};

// Creates an EC2 instance in the same subnet as this Lambda.
// Returns the instanceId, and its private ip address.
// If the instance creatiom fails, or the instance is not running, 
// or is not ready for use, terminates it (if created) and returns null.
const launchEC2Instance = async (runme,role) => {
  console.log("Enter launchEC2Instance");
  const startTime = curTime();
  const stage = process.env.STAGE;
  const awsRegion = process.env.REGION;
  const subnetIds = process.env.SUBNET_IDS.split(',');
  const subnetId = subnetIds[Math.floor(Math.random() * subnetIds.length)];
  const securityGroupId = process.env.SECURITY_GROUP_ID;
  const ec2type = process.env.EC2_TYPE;
  const ec2ami = process.env.EC2_AMI;
  const keyPairName = process.env.KEYPAIR_NAME;
  const script = // Run the passed in 'runme', and terminate this instance
`#!/bin/bash
sudo -u ec2-user -i <<'EOF'
export AWS_REGION=${awsRegion}
echo "${runme}" > ./runme
chmod +x ./runme
./runme 
# Terminating this instance
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/instance-id")
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$AWS_REGION"
EOF
`;
  console.log("Script: " + script);
  const scriptBase64 = Buffer.from(script).toString('base64');
  const params = {
    TagSpecifications: [{ 
      ResourceType: 'instance', 
      Tags: [ { Key: 'Name', Value: `launchEC2-${stage}` } ] 
    }],
    ImageId: ec2ami,
    InstanceType: ec2type,
    KeyName: keyPairName,
    MinCount: 1,
    MaxCount: 1,
    NetworkInterfaces: [{
      SubnetId: subnetId,
      AssociatePublicIpAddress: false,
      DeviceIndex: 0,
      Groups: [securityGroupId],
    }],
    IamInstanceProfile: {
        Name: role
    },
    UserData: scriptBase64
  };
  console.log("params: " + JSON.stringify(params,null,2));
  let instance = { id: null, ipaddr: null};
  const ec2Client = new EC2Client();
  console.log("calling ec2Client.send(new RunInstancesCommand(params))");
  const result = await ec2Client.send(new RunInstancesCommand(params));
  instance.id = result.Instances[0].InstanceId;
  instance.ipaddr = result.Instances[0].PrivateIpAddress;
  console.log("Launched instance " + instance.id + " @ " + instance.ipaddr);
  console.log(elapsedTime(startTime) + " seconds");
  let ok = await waitForInstanceRunning(instance);
  if (ok) 
    ok = await waitForInstanceReady(instance);
  if (ok) {
    console.log("Exit launchEC2Instance, instance ready");
    return instance;
  }
  else {
    console.log("Exit launchEC2Instance, failed to launch instance");
    return null;
  }    
};

// Waits for an EC2 instance to be running, and returns true.
// If the instance does does not start to run, returns false.
const waitForInstanceRunning = async (instance) => {
  console.log("Waiting for instance " + instance.id + " to be running...");
  const waitParams = { InstanceIds: [instance.id] };
  let startTime = curTime();
  const ec2Client = new EC2Client();
  const response = await waitUntilInstanceRunning(
                        { client: ec2Client, maxWaitTime: 60 }, waitParams);
  const ok = (response.state == "SUCCESS") ? true : false;
  console.log("EC2 instance " + instance.id + 
              " is " + (ok ? "" : "not ") + "running");
  console.log(elapsedTime(startTime) + " seconds");
  return ok;
};

// Waits for an EC2 instance to be ready for use, and returns itrue. 
// If the instance does not become ready, returns false.
const waitForInstanceReady = async (instance) => {
  console.log("Waiting for instance " + instance.id + " to be ready...");
  const waitParams = { InstanceIds: [instance.id] };
  let startTime = curTime();
  const ec2Client = new EC2Client();
  const pollInterval = 10; // seconds
  const timeout = 420; // 7 minutes
  for (let timecnt = 0; timecnt < timeout; timecnt += pollInterval) {
    const describeStatus = new DescribeInstanceStatusCommand(waitParams);
    const response = await ec2Client.send(describeStatus);
    const instanceStatus = response.InstanceStatuses[0];
    if (instanceStatus && 
        instanceStatus.InstanceStatus &&
        instanceStatus.InstanceStatus.Status === "ok" &&
        instanceStatus.SystemStatus && 
        instanceStatus.SystemStatus.Status === "ok") {
      console.log("Instance " + instance.id + " is ready");
      console.log(elapsedTime(startTime) + " seconds");
      return true;
    } 
    await new Promise(resolve => setTimeout(resolve,pollInterval*1000));
  }
  console.error("Timed out waiting for instance to become ready");
  return null;
};
