import * as github from '@actions/github';
import S3 from '../s3Client';
import s3UploadDirectory from '../utils/s3UploadDirectory';
import validateEnvVars from '../utils/validateEnvVars';
import checkBucketExists from '../utils/checkBucketExists';
import githubClient from '../githubClient';
import deactivateDeployments from '../utils/deactivateDeployments';
import { ReposCreateDeploymentResponseData } from '@octokit/types';

export const requiredEnvVars = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
];

export default async (bucketName: string, folderName: string, uploadDirectory: string, environmentPrefix: string, websiteUrlTemplate: string) => {
  const prNumber = github.context.payload.pull_request!.number;
  const websiteUrl = buildWebsiteUrl(bucketName, websiteUrlTemplate, prNumber)
  const { repo } = github.context;
  const branchName = github.context.payload.pull_request!.head.ref;

  console.log('PR Updated');

  validateEnvVars(requiredEnvVars);

  const bucketExists = await checkBucketExists(bucketName);

  if (!bucketExists) {
    console.log('S3 bucket does not exist. Creating...');
    await S3.createBucket({ Bucket: bucketName }).promise();

    console.log('Configuring bucket website...');
    await S3.putBucketWebsite({
      Bucket: bucketName,
      WebsiteConfiguration: {
        IndexDocument: { Suffix: 'index.html' },
        ErrorDocument: { Key: 'index.html' },
      },
    }).promise();
  } else {
    console.log('S3 Bucket already exists. Skipping creation...');
  }

  await deactivateDeployments(repo, environmentPrefix);

  const deployment = await githubClient.repos.createDeployment({
    ...repo,
    ref: `refs/heads/${branchName}`,
    environment: `${environmentPrefix || 'PR-'}${prNumber}`,
    auto_merge: false,
    transient_environment: true,
    required_contexts: [],
  });

  if (isSuccessResponse(deployment.data)) {
    await githubClient.repos.createDeploymentStatus({
      ...repo,
      deployment_id: deployment.data.id,
      state: 'in_progress',
    });

    console.log('Uploading files...');
    await s3UploadDirectory(bucketName, folderName, uploadDirectory);

    await githubClient.repos.createDeploymentStatus({
      ...repo,
      deployment_id: deployment.data.id,
      state: 'success',
      environment_url: websiteUrl,
    });

    console.log(`Website URL: ${websiteUrl}`);
  }
};

function buildWebsiteUrl(bucketName: string, websiteUrlTemplate: string, prNumber: number) {
  if(websiteUrlTemplate) {
    console.log('Website URL Template: ', websiteUrlTemplate)
    return websiteUrlTemplate.replace('%prNumber%', `${prNumber}`);
  }
  console.log('No Website URL Template found');
  return `http://${bucketName}.s3-website-us-east-1.amazonaws.com`;
}

function isSuccessResponse(
  object: any
): object is ReposCreateDeploymentResponseData {
  return 'id' in object;
}
