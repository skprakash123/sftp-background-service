import express from "express";
import * as bodyParser from "body-parser";
import axios from "axios";
const dotenv = require("dotenv").config();
const Client = require("ssh2-sftp-client");
const sftp = new Client();
import { Storage } from "@google-cloud/storage";
import { PubSub } from "@google-cloud/pubsub";

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

const app = express();
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

app.use(bodyParser.json());

//This POST API will upload the downloaded files to Google storage area in the bucket
app.post("/", (req: any, res: any) => {
  console.log("req.body.downloadedFiles", req.body.downloadedFiles);
  for (let i = 0; i < req.body.downloadedFiles.length; i++) {
    const fileName = req.body.downloadedFiles[i].split(".")[0];
    console.log("file object", req.body.downloadedFiles[i]);
    //On the cloud storage area based on the file name we are storing data in different folders
    const destinationFolder = fileName.includes("QAR")
      ? "QAR_data_files/"
      : "ODW_data_files/";
    console.log("destinationFolder", destinationFolder);
    //This function will upload the files to bucket
    Bucket.upload(
      `${process.env.destinationPath}${req.body.downloadedFiles[i]}`,
      {
        destination: `${destinationFolder}${req.body.downloadedFiles[i]}`,
      },
      function(err: any, file: any) {
        if (err) {
          console.error(`Error uploading file: ${err}`);
        } else {
          console.log(`File uploaded to ${bucketName}.`);
          const payload = JSON.stringify({
            fileType: fileName.includes("QAR") ? "QAR" : "ODW",
            fileName: req.body.downloadedFiles[i],
            bucketName,
            fileLocation: `https://storage.googleapis.com/${bucketName}/${req.body.downloadedFiles[i]}`,
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
        console.log(file, "This is file output");
      }
    );
  }
  res.status(200).json({
    status: 200,
    message: "Files uploaded successfully",
  });
});

app.post("/listen", (req: any, res: any) => {
  try {
    const message = req.body ? req.body.message : null;
    console.log("message", message);
    if (message) {
      const buffer = Buffer.from(message.data, "base64").toString();
      const data = JSON.parse(buffer!);
      console.log("data", data);
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

app.listen(3000, function() {
  console.log("server is running on port 3000");
  downloadFolder();
});

//This function will get called via backgroung job service and will download the files from source SFTP
async function downloadFolder() {
  try {
    //Connection to the SFTP server (This will be in configurable - For now it is static as we have demo SFTP server)
    await sftp.connect({
      host: "dnt3.files.com",
      port: 22,
      user: "ruchita.dnt@yopmail.com",
      password: "Rns@19972906",
      secure: true,
    });
    console.log("Connected to SFTP server");
    //This will list all the files present in the SFTP server
    const fileList = await sftp.list(process.env.ftpServerPath);

    const allFiles: string[] = [];

    for (let i = 0; i < fileList.length; i++) {
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
          .then(() => {
            console.log("in then of sftp get");
            allFiles.push(`${fileList[i].name}`);
          })
          .catch((err: any) => console.log("error in file get from sftp", err));
      }
    }
    console.log("Folder download complete");
    await doPostRequest({ downloadedFiles: allFiles });
  } catch (err) {
    console.error(err);
  } finally {
    await sftp.end();
    console.log("Disconnected from SFTP server");
  }
}

async function doPostRequest(payload: any) {
  console.log("payload", payload);
  let res = await axios.post(`${process.env.apiURL}`, payload);
  let data = res;
  console.log(data);
}
