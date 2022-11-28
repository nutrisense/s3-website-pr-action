import S3 from '../s3Client';

export default async (bucketName: string, folderName: string) => {
  try {
    await S3.headObject({ Bucket: bucketName, Key: folderName }).promise();
    return true;
  } catch (e) {
    return false;
  }
};
