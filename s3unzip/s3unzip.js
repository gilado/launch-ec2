// Sample code to unzip a file stored in S3 and store back its content
// in a folder with same name as zip file without the .zip suffix.
const path = require('path');
const { 
  S3Client, 
  GetObjectCommand, 
  PutObjectCommand 
} = require('@aws-sdk/client-s3');
const { 
  LambdaClient, 
  InvokeCommand 
} = require("@aws-sdk/client-lambda");
const unzipper = require('unzipper');

const curTime = require('performance-now'); /* Time in milliseconds */
/* Returns number of seconds since startTime */
const elapsedTime = (startTime) => ((curTime()-startTime)/1000).toFixed(3);

const IS_LAMBDA = process.env.AWS_LAMBDA_FUNCTION_NAME;
const STAGE = process.env.STAGE;
const EARLY_STOP = parseInt(process.env.EARLY_STOP,10);
const S3UNZIP_BUCKET = process.env.S3UNZIP_BUCKET;

const awsRegion = process.env.AWS_REGION;
const s3Client = new S3Client({ region: awsRegion });

/* Lambda's entry point
 * Example event:
 * {
 *   "bucketName": "s3unzip",
 *   "zipFileName": "file_to_be_unzipped.zip"
 * }
 */
exports.s3unzip = async (event) => {
  console.log("event " + JSON.stringify(event,null,2));
  const bucketName = event.bucketName;
  const zipFileName = event.zipFileName;

  if (!bucketName || !zipFileName) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Missing bucketName or zipFileName' })
    };
  }
  try {
    const done = await unzipAndUpload(bucketName, zipFileName);
    if (done) {
      return {
        statusCode: 200,
        body: JSON.stringify({message: 'Files uploaded successfully'})
      };
    }
    console.log("Launching a micro EC2 to reprocess the zip file");
    await launchEC2(event);
    return {
      statusCode: 200,
      body: JSON.stringify({message: 'Restarting using an EC2'})
    };
  } 
  catch (error) {
    console.error('Error occurred:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'An error occurred', error: error.message }),
    };
  }
};

async function uploadEntryToS3(bucketName, key, content) {
  try {
    const uploadParams = {
      Bucket: bucketName,
      Key: key,  // The destination key in S3
      Body: content,  // The entry data
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
    //console.log("Uploaded to S3: " + key);
  } 
  catch (error) {
    console.error("Error uploading " + key + " to S3:" + error);
    throw error;
  }
}

async function unzipAndUpload(bucketName, zipKey) {
  let earlyStop = false;
  try {
    startTime = curTime();
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: zipKey,
    });

    // Get the zip file from S3 as a stream
    const s3Stream = await s3Client.send(command);
    const readStream = s3Stream.Body;

    // Extract zip file base name (without .zip extension)
    const zipBaseName = path.basename(zipKey, '.zip');

    // Download one file at a time from the zip file, and upload to S3
    await new Promise((resolve, reject) => {
      readStream
        .pipe(unzipper.Parse())
        .on('entry', async (entry) => {
          const entryPath = entry.path;
          const fileName = entryPath.split('/').pop();
          
          if (entry.type === 'File') {
            const s3EntryKey = `${zipBaseName}/${entryPath}`; // S3 key: folder + entry path

            // Collect entry content into buffer and upload to S3
            let chunks = [];
            entry.on('data', (chunk) => {
              chunks.push(chunk);
            });

            entry.on('end', async () => {
              const fileContent = Buffer.concat(chunks);
              await uploadEntryToS3(bucketName, s3EntryKey, fileContent);
              if (IS_LAMBDA) {
                if (elapsedTime(startTime) > EARLY_STOP) {
                  console.log("Some entries were processed");
                  earlyStop = true;
                  resolve();
                }
              }
            });

            entry.on('error', (err) => {
              console.error("Error processing entry " + fileName + ": " + err);
            });
          } 
          else
            entry.autodrain(); // Skip non-file entries
        })
        .on('finish', () => {
          console.log("All entries were processed");
          resolve();
        })
        .on('error', (err) => {
          console.error('Error reading zip stream:', err);
          reject(err);
        });
    });
  } 
  catch (error) {
    console.error('Error fetching zip file from S3:', error);
    earlyStop = true;
    throw error;
  }
  return !earlyStop;
}

async function launchEC2 (event) {
  const bucketName = event.bucketName;
  const zipFileName = event.zipFileName;
  const runme = 
`#!/bin/bash
sudo yum update -y
sudo yum install -y nodejs
aws s3 cp s3://launchec2-${STAGE}/s3unzip.zip .
unzip s3unzip.zip
node s3unzip.js ${bucketName} ${zipFileName}
`;
  const role = `s3unzip-ec2Role-${STAGE}`;
  const newEvent = { "runme": runme, "role": role };

  try {
    const client = new LambdaClient({ region: awsRegion });
  
    const params = {
      FunctionName: `launchEC2-${STAGE}-launchEC2`,
      InvocationType: "Event", // Asynchronous invocation
      Payload: JSON.stringify(newEvent)
    };

    const command = new InvokeCommand(params);
    await client.send(command);
    console.log("launchEC2 Lambda function invoked asynchronously.");
  } 
  catch (error) {
    console.error("Error invoking launchEC2 Lambda function:", error);
    throw error;
  }
}

/* EC2 entry point
 * Example command line
 * node s3unzip.js s3unzip GPD_Images_10-14-24_20241015_063135.zip
 */
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  console.log("process.argv.length " + process.argv.length);
  console.log(JSON.stringify(process.argv,null,2));
  if (process.argv.length == 4) {
    const event = {
      "bucketName": process.argv[2],
      "zipFileName": process.argv[3]
    };
    (async () => {
      try {
        const data = await exports.s3unzip(event);
        console.log(data);
      } 
      catch (error) {
        console.error("Error:", error);
      }
    })();
  }
  else
    console.log("syntax: node s3unzip.js <bucketName> <zipFileName>");
}
