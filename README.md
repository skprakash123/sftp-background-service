# Backgroud Service - SFTP (Which download the Source Files into storage area)

This service is intend to be a background job service which will download the Source files into google cloud storage area on a certain time.

### Example .env as per below

```
ftpServerPath = '/Source/'
allFileExtension = 'txt'
destinationPath = "/Users/ruchitashah/"
bucketName = "sftp_downloaded_data"
```

## Important notes

Run `npm install` to install node_modules.

### NOTE 1

Use the flags as shown in `npm install yourmodule --save --save-exact` for installing new npm modules.

## Run a project in local

Run `num run start`

## Pushing a container to GCR

--> Pre-requisite
- Install the GCloud SDK on local machine
- Set up the gCloud project in local machine with following command
  ```
  gcloud init
  ```

Following are the steps to pushing a container to GCR

- gcloud builds submit --tag gcr.io/<project_name>/docker-image .

- From google container registry –> deploy the lastest docker image to GKE

- Reserve a static IP - gcloud compute addresses create gke-tutorial-ip

- Install kubernetes components - gcloud components install kubectl

- Authorize the kubernetes cluster - gcloud container clusters get-credentials <CLUSTER_NAME> --zone <ZONE>

- kubectl apply -f k8s/

- gcloud compute addresses list
