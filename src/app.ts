import express from "express";
import * as bodyParser from "body-parser";
import axios from "axios";
const dotenv = require("dotenv").config();
const Client = require("ssh2-sftp-client");
const sftp = new Client();
import { Storage } from "@google-cloud/storage";
import { PubSub } from "@google-cloud/pubsub";
import { join } from "path";

const gcpConfig = {
  projectId: process.env.PROJECT_ID,
  credentials: {
    token_url: process.env.TOKEN_URL,
    client_email: process.env.CLIENT_EMAIL,
    client_id: process.env.CLIENT_ID,
    private_key: process.env.PRIVATE_KEY,
  },
};

//GCS - Cloud storage details
const storage = new Storage(gcpConfig);
const pubsub = new PubSub(gcpConfig);

if (!dotenv) {
  throw new Error("Unable to use dot env lib");
}

// Set the NODE_ENV to 'development' by default
process.env.NODE_ENV = "development";

//Bucket name should read from the environment variables
const bucketName = process.env.bucketName;
const Bucket = storage.bucket(bucketName!);

// express server
const app = express();

// middlware for parse data in urlencoded
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

// middlware for parse data in json
app.use(bodyParser.json());

//This POST API will upload the downloaded files to Google storage area in the bucket
app.post("/", (req: any, res: any) => {
  console.log("req.body.downloadedFiles", req.body.downloadedFiles);
  for (let i = 0; i < req.body.downloadedFiles.length; i++) {
    const parentFolderName = req.body.downloadedFiles[i].split("/")[0];
    const fileName = req.body.downloadedFiles[i].split("/")[1];
    const fileNameWithoutExt = req.body.downloadedFiles[i]
      .split("/")[1]
      .split(".")[0];
    //On the cloud storage area based on the file name we are storing data in different folders
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const date = currentDate.getDate();
    const destinationFolder = `QAR/${parentFolderName}/${year}/${month}/${date}/`;
    // const destinationFolder = fileNameWithoutExt.includes("QAR")
    //   ? `QAR/${parentFolderName}/${year}/${month}/${date}/`
    //   : "ODW_data_files/";
    //This function will upload the files to bucket
    Bucket.upload(
      `${process.env.destinationPath}${fileName}`,
      {
        destination: `${destinationFolder}${fileName}`,
      },
      function(err: any, file: any) {
        if (err) {
          console.error(`Error uploading file: ${err}`);
        } else {
          console.log(`File uploaded to ${bucketName}.`);

          // send message to GCP Pub/Sub
          const payload = JSON.stringify({
            fileType: "QAR",
            // fileType: fileName.includes("QAR") ? "QAR" : "ODW",
            fileName: fileName,
            bucketName,
            fileLocation: `https://storage.googleapis.com/${bucketName}/${destinationFolder}${fileName}`,
          });
          const payloadBuffer = Buffer.from(payload);
          pubsub
            .topic("ge-queue")
            .publishMessage({ data: payloadBuffer }, (error, messageId) => {
              if (error) {
                console.log("Publish message Error", error);
              } else {
                console.log("Publish message Success messageId: ", messageId);
              }
            });
        }
      }
    );
  }
  res.status(200).json({
    status: 200,
    message: "Files uploaded successfully",
  });
});

// This endpoint is for Document Management API. Listen all messages from Google Pub/Sub.
app.post("/listen", (req: any, res: any) => {
  try {
    const message = req.body ? req.body.message : null;
    console.log("message", message);
    if (message) {
      const buffer = Buffer.from(message.data, "base64").toString();
      const data = JSON.parse(buffer!);
      console.log("Ack Message", message.messageId);
      return res.status(200).json({ messageId: message.messageId, data: data });
    } else {
      return res.status(200).json({ data: "No message data found" });
    }
  } catch (error) {
    console.log("Error in listen message", error);
    return res.status(500).json({
      code: 500,
      status: "Internal Server Error",
      message: error,
    });
  }
});

//This function will get called via backgroung job service and will download the files from source SFTP
async function downloadFolder() {
  try {
    //Connection to the SFTP server (This will be in configurable - For now it is static as we have demo SFTP server)
    await sftp.connect({
      host: "35.228.207.19",
      port: 22,
      user: "user7",
      password: "User7@123",
      secure: true,
    });
    console.log("Connected to SFTP server");

    const fileArrays: String[] = [];
    const allextension = process.env.allFileExtension || "txt";
    //This will list all the files present in the SFTP server
    await downloadFiles(process.env.ftpServerPath!, fileArrays, allextension);
    console.log("fileArrays", fileArrays);
    await doPostRequest({ downloadedFiles: fileArrays });
  } catch (err) {
    console.error(err);
  } finally {
    await sftp.end();
    console.log("Disconnected from SFTP server");
  }
}

// Function for download all files from sftp.
const downloadFiles = async (
  path: string,
  filesArray: any,
  allextension: string
) => {
  try {
    const files = await sftp.list(path);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileExtension = file.name.split(".")[1];
      const filePath = join(path, file.name);
      const stat = await sftp.stat(filePath);
      // console.log("stat of ", file.name);
      // console.log("stat", stat);
      if (stat.isDirectory) {
        await downloadFiles(filePath, filesArray, allextension);
      } else {
        console.log("path ", path);
        console.log("fileArrays", filesArray);
        if (
          allextension.includes("*") ||
          allextension.includes(fileExtension)
        ) {
          await sftp.get(
            `${filePath}`,
            `${process.env.destinationPath}${file.name}`
          );
          const removePath = path.split("/")[1];
          // if (filesArray.length > 0) {
          //   await filesArray.find((d: any, i: number) => {
          //     if (d.folderName == path) {
          //       filesArray[i].fileName.push(file.name);
          //       return true;
          //     }
          //   });
          // } else {
          //   filesArray.push({ folderName: path, fileName: [] });
          // }
          filesArray.push(`${removePath}/${file.name}`);
        }
      }
    }

    return filesArray;
  } catch (error) {
    console.error("Error from getAllFiles", error);
  }
};

// API call for send data to FileReciver API
async function doPostRequest(payload: any) {
  console.log("payload", payload);
  let res = await axios.post(`${process.env.apiURL}`, payload);
  let data = res;
  console.log("API resp", data);
}

app.listen(3000, function() {
  console.log("server is running on port 3000");
  downloadFolder();
});
