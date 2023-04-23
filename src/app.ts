import express from 'express';
import * as bodyParser from 'body-parser';
const dotenv = require("dotenv").config();
const Client = require("ssh2-sftp-client");
const sftp = new Client();
const { Storage } = require("@google-cloud/storage");
//GCS - Cloud storage details
const storage = new Storage({
  projectId: "ge-dms-new",
  keyFilename: "./google-cloud-key.json",
});

if (!dotenv) {
  throw new Error("Unable to use dot env lib");
}
// Set the NODE_ENV to 'development' by default
process.env.NODE_ENV = "development";
//Bucket name should read from the environment variables
const bucketName = process.env.bucketName;
const Bucket = storage.bucket(bucketName);

const app = express();
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

app.use(bodyParser.json());

//This POST API will upload the downloaded files to Google storage area in the bucket
app.post("/", (req: any, res: any) => {
  console.log(req.body.downloadedFiles);
  for (let i = 0; i < req.body.downloadedFiles.length; i++) {
    const fileName = req.body.downloadedFiles[i].split(".")[0];
    console.log("file object", req.body.downloadedFiles[i]);
    //On the cloud storage area based on the file name we are storing data in different folders
    const destinationFolder = fileName.includes("QAR")
      ? "QAR_data_files"
      : "ODW_data_files";
    console.log("destinationFolder", destinationFolder);
    //This function will upload the files to bucket
    Bucket.upload(
      `${req.body.downloadedFiles[i]}`,
      {
        destination: `${destinationFolder}${req.body.downloadedFiles[i]}`,
      },
      function (err: any, file: any) {
        if (err) {
          console.error(`Error uploading file: ${err}`);
        } else {
          console.log(`File uploaded to ${bucketName}.`);
        }
        console.log(file, "This is file output");
      }
    );
  }
  res.status(200).json({
    status: 200,
    message: "Files uploaded successfully"
  });
});

app.listen(3003, function () {
  console.log("server is running on port 3003");
  downloadFolder();
});

//This function will get called via backgroung job service and will download the files from source SFTP
async function downloadFolder() {
  try {
    //Connection to the SFTP server (This will be in configurable - For now it is static as we have demo SFTP server)
    await sftp.connect({
      host: "dnt2.files.com",
      port: 22,
      user: "xobaxav793@lieboe.com",
      password: "Rns@19972906",
      secure: true,
    });
    console.log("Connected to SFTP server");
    console.log(process.env.ftpServerPath, process.env.allFileExtension);
    //This will list all the files present in the SFTP server
    const fileList = await sftp.list(process.env.ftpServerPath);
    console.log("Retrieved remote folder contents:", fileList);

    for (let i = 0; i < fileList.length; i++) {
      console.log("file object", fileList[i].name);
      const extension = fileList[i].name.split(".")[1];
      const fileName = fileList[i].name.split(".")[0];
      const allextension = process.env.allFileExtension || "txt";
      /* We will download only the given extension files and if the extension is passed as * then will download all 
         the files from that SFTP directory location */
      if (allextension.includes("*") || allextension.includes(extension)) {
        console.log("in if of extension", fileName);
        //Download the files to the destination location
        await sftp
          .get(
            `${process.env.ftpServerPath}${fileList[i].name}`,
            `${process.env.destinationPath}${fileList[i].name}`
          )
          .catch((err: any) => console.log("error in file get from sftp", err));
      }
    }
    console.log("Folder download complete");
  } catch (err) {
    console.error(err);
  } finally {
    await sftp.end();
    console.log("Disconnected from SFTP server");
  }
}
