// Initialise .env config.
require('dotenv').config();

// Options
var options = {
  port: process.env.PORT || 80, // Heroku port or 80.
  unityAPIBase: "https://build-api.cloud.unity3d.com/", // URI (e.g. href) recieved in web hook payload.
  unityCloudAPIKey: process.env.UNITYCLOUD_KEY,
  hockeyappAPIUpload: "https://rink.hockeyapp.net/api/2/apps/upload",
  hockeyappAPIKey: process.env.HOCKEYAPP_KEY
};

// Imports
var path = require('path'),
    fs = require('fs'),
    express = require('express'),
    app = express(),
    http = require('http'),
    https = require('https'),
    server = http.Server(app),
    bodyParser = require('body-parser'),
    najax = require('najax'),
    FormData = require('form-data'),
    _ = require('lodash'),
    url = require("url");

// Run Server
server = server.listen( options.port, function(){
  console.log('listening on *:' + options.port );
});

// Configure Express
app.use('/public', express.static('public'));

// parse application/json
// app.use(bodyParser.json()); // Parse all
var jsonParser = bodyParser.json();

app.get('/', function(req, res){
  res.sendFile( __dirname + '/index.html' );
});

// POST /api/users gets JSON bodies 
var mainRes;
app.post('/build', jsonParser, function (req, res) {
    if (!req.body) return res.sendStatus(400);

    mainRes = res;

    printProjectDetails(req.body);

    // 1. Get Build API URL
    var buildAPIURL = req.body.links.api_self.href;
    if( !buildAPIURL ) {
        // URL not available.
        res.setHeader('Content-Type', 'application/json');
        res.send({
            error: true,
            message: "No build link from Unity Cloud Build webhook"
        });
    } else {
        // URL available.
        res.setHeader('Content-Type', 'application/json');
        res.send({
            error: false,
            message: "Process begun for project '" + req.body.projectName + "' platform '" + req.body.buildTargetName + "'."
        });
    }

    // 2. Grab binary URL from Unity Cloud API
    getBuildDetails( buildAPIURL );
});

function getBuildDetails( buildAPIURL ){
    console.log("1. getBuildDetails: start");

    najax({ 
        url: options.unityAPIBase + buildAPIURL,
        type: 'GET', 
        headers: {
            'Authorization': 'Basic ' + options.unityCloudAPIKey
        },
        success: function(data){
            console.log("1. getBuildDetails: finished");

            data = JSON.parse(data);

            switch (data.buildStatus) {
                case 'queued':
                    handleSuccess(data);
            }

            console.log("1. getBuildDetails: job done");
        },
        error: function(error){
            console.log(error);

            mainRes.setHeader('Content-Type', 'application/json');
            mainRes.send({
                error: true,
                message: "Problem getting build details from Unity Cloud Build.",
                errorDump: error
            });
        }
    });
}

/**
 * print build status details
 *
 * @param {Object} data
 */
function printProjectDetails(data) {
    console.log('Project: ' + data.projectName);
    console.log('Target: ' + data.buildTargetName);
    console.log('Started by: ' + data.startedBy);
    console.log('Build status: ' + data.buildStatus);
}

/**
 * Job success received
 * Download artifact and upload to hockey app
 *
 * @param {Object} data
 */
function handleSuccess(data) {
    var parsed = url.parse( data.links.download_primary.href );
    var filename = path.basename( parsed.pathname );

    // 3. Download binary.
    downloadBinary( data.links.download_primary.href, filename );

    createShareLink(data);
}

function createShareLink() {
    var shareAPIURL = data.links.create_share.href,
        method = data.links.create_share.method;

    console.log("createShareLink: started");
    najax({
        url: options.unityAPIBase + shareAPIURL,
        type: method,
        headers: {
            'Authorization': 'Basic ' + options.unityCloudAPIKey
        },
        success: function(data){
            console.log("createShareLink: finished");
            console.log("Response", response);
        },
        error: function(error){
            console.log(error);

            mainRes.setHeader('Content-Type', 'application/json');
            mainRes.send({
                error: true,
                message: "Problem creating share link at Unity Cloud Build.",
                errorDump: error
            });
        }
    });
}

/**
 *
 * @param {Object} data
 */
function handleStarted(data) {

}

/**
 *
 * @param {Object} data
 */
function handleQueued(data) {

}

/**
 *
 * @param {Object} data
 */
function handleCanceled(data) {

}

function downloadBinary( binaryURL, filename ){
    
    console.log("2. downloadBinary: start");
    console.log("   " + binaryURL);
    console.log("   " + filename);

    deleteFile( filename );
    
    https.get( binaryURL, (res) => {
        // console.log('statusCode: ', res.statusCode);
        // console.log('headers: ', res.headers);

        var writeStream = fs.createWriteStream(filename, {'flags': 'a'});

        var len = parseInt(res.headers['content-length'], 10);
        var cur = 0;
        var total = len / 1048576; //1048576 - bytes in  1Megabyte

        res.on('data', (chunk) => {
            cur += chunk.length;
            writeStream.write(chunk, 'binary');

            console.log("Downloading " + (100.0 * cur / len).toFixed(2) + "%, Downloaded: " + (cur / 1048576).toFixed(2) + " mb, Total: " + total.toFixed(2) + " mb");
        });

        res.on('end', () => {
            console.log("2. downloadBinary: finished");
            writeStream.end();
        });

        writeStream.on('finish', () => {
            // console.log("2. downloadBinary: file finished");          
            uploadToHockeyApp( filename );
        });
    }).on('error', (e) => {
      console.error(e);
    });
}

function uploadToHockeyApp( filename ){
    console.log("3. uploadToHockeyApp: start");
    // console.log("readfile: " + filename);

    var readable = fs.createReadStream( filename );
    readable.on('error', () => {
      console.log('Error reading binary file for upload to HockeyApp');
    });

    // HockeyApp properties
    var HOCKEY_APP_HOST = 'rink.hockeyapp.net';
    var HOCKEY_APP_PATH = '/api/2/apps/upload/';
    var HOCKEY_APP_PROTOCOL = 'https:';

    // Create FormData
    var form = new FormData();
    form.append('status', 2);
    // form.append('mandatory', MANDATORY_TYPE[options.mandatory]);
    form.append('notes', "Automated release triggered from Unity Cloud Build.");
    form.append('notes_type', 0);
    form.append('notify', 0);
    form.append('ipa', readable);

    var req = form.submit({
      host: HOCKEY_APP_HOST,
      path: HOCKEY_APP_PATH,
      protocol: HOCKEY_APP_PROTOCOL,
      headers: {
        'Accept': 'application/json',
        'X-HockeyAppToken': options.hockeyappAPIKey
      }
    }, function (err, res) {
        if (err) {
            console.log(err);
        }

        if (res.statusCode !== 200 && res.statusCode !== 201) {
            console.log('Uploading failed with status ' + res.statusCode);
            console.log(res);
            // res.on('data', function (chunk) {
            //   console.log(chunk);
            //             // res.on('end', function () {
            //   console.log("end");
            // });
            return;
        }

        var jsonString = '';
        res.on('data', (chunk) => {
        
            jsonString += String.fromCharCode.apply(null, new Uint16Array( chunk ));

        });

        res.on('end', () => {

            console.log("3. uploadToHockeyApp: finished");

            // console.log(jsonString);

            deleteFile( filename );

        });
    });
    
    // Track upload progress.
    // console.log( req );
    var len = parseInt( req.getHeader( 'content-length' ), 10);
    var cur = 0;
    var total = len / 1048576; //1048576 - bytes in  1Megabyte

    req.on('data', (chunk) => {
        cur += chunk.length;
        console.log("Downloading " + (100.0 * cur / len).toFixed(2) + "%, Downloaded: " + (cur / 1048576).toFixed(2) + " mb, Total: " + total.toFixed(2) + " mb");
    });

}

// Delete file, used to clear up any binary downloaded.
function deleteFile( filename ){
    fs.exists(filename, function(exists) { 
      if (exists) { 
        // Delete File.
        fs.unlink( filename );
      } 
    }); 
}
