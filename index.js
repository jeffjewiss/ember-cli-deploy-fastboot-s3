/* eslint-env node */
'use strict';

var BasePlugin = require('ember-cli-deploy-plugin');
var RSVP = require('rsvp');
var fs = require('fs-extra');
var path = require('path');
var archiver = require('archiver');

var AWS = require('aws-sdk');

var DEFAULT_DEPLOY_INFO = 'fastboot-deploy-info.json';
var DEFAULT_DEPLOY_ARCHIVE = 'dist';

module.exports = {
  name: 'ember-cli-deploy-fastboot-s3',

  createDeployPlugin: function(options) {
    var DeployPlugin = BasePlugin.extend({
      name: options.name,

      defaultConfig: {
        archivePath: path.join('tmp', DEFAULT_DEPLOY_ARCHIVE),
        archiveType: 'zip',
        deployInfo: DEFAULT_DEPLOY_INFO,
        deployArchive: DEFAULT_DEPLOY_ARCHIVE,
        distDir: function(context) {
          return context.distDir;
        },
        revisionKey: function(context) {
          return (
            context.commandOptions.revision ||
            (context.revisionData && context.revisionData.revisionKey)
          );
        },
        s3Client: function(context) {
          return context.s3Client;
        }
      },

      requiredConfig: ['bucket'],

      configure: function(/*context*/) {
        // Ensure default config is applied
        this._super.configure.apply(this, arguments);

        // If a custom S3 client is configured then the rest of the
        // configuration is redundant.
        if (this.readConfig('s3Client')) {
          return;
        }

        // An endpoints makes the region config redundant, however
        // at least one of them must be present.
        if (!this.readConfig('region') && !this.readConfig('endpoint')) {
          var message = `You must configure either an 'endpoint' or a 'region' to use the AWS.S3 client.`;

          this.log(message, { color: 'red' });
          throw new Error(message);
        }
      },

      setup: function(/*context*/) {
        this.s3 =
          this.readConfig('s3Client') ||
          new AWS.S3({
            region: this.readConfig('region'),
            accessKeyId: this.readConfig('accessKeyId'),
            secretAccessKey: this.readConfig('secretAccessKey'),
            endpoint: this.readConfig('endpoint')
          });
      },

      didPrepare: function(/*context*/) {
        var self = this;
        return this._pack().then(function() {
          var archiveName = self._buildArchiveName();
          self.log('✔  ' + archiveName, { verbose: true });
        });
      },

      upload: function(/*context*/) {
        var self = this;
        var prefix = this.readConfig('prefix');
        var archiveName = this._buildArchiveName();
        this.key = prefix ? [prefix, archiveName].join('/') : archiveName;

        return this._upload(self.s3)
          .then(function() {
            self.log('✔  ' + self.key, { verbose: true });
            return RSVP.Promise.resolve();
          })
          .catch(this._errorMessage.bind(this));
      },

      activate: function(/* context */) {
        var self = this;
        var revisionKey = this.readConfig('revisionKey');

        this.log(`preparing to activate ${revisionKey}`, {
          verbose: true
        });

        return this._uploadDeployInfo(self.s3)
          .then(function() {
            self.log(`✔  ' activated revison ${revisionKey}`, {
              verbose: true
            });
          })
          .catch(this._errorMessage.bind(this));
      },

      _upload: function(s3) {
        var archivePath = this.readConfig('archivePath');
        var archiveName = this._buildArchiveName();
        var prefix = this.readConfig('prefix');
        var key = prefix ? [prefix, archiveName].join('/') : archiveName;
        var fileName = path.join(archivePath, archiveName);

        var file = fs.createReadStream(fileName);
        var bucket = this.readConfig('bucket');
        var params = {
          Bucket: bucket,
          Key: key,
          Body: file
        };

        this.log('preparing to upload to S3 bucket `' + bucket + '`', {
          verbose: true
        });

        return s3.putObject(params).promise();
      },

      _uploadDeployInfo: function(s3 /*, key*/) {
        var deployInfo = this.readConfig('deployInfo');
        var bucket = this.readConfig('bucket');
        var prefix = this.readConfig('prefix');
        var body = this._createDeployInfo();
        var key = prefix ? [prefix, deployInfo].join('/') : deployInfo;
        var params = {
          Bucket: bucket,
          Key: key,
          Body: body
        };

        return s3.putObject(params).promise();
      },

      _createDeployInfo() {
        var bucket = this.readConfig('bucket');
        var prefix = this.readConfig('prefix');
        var archiveName = this._buildArchiveName();
        var key = prefix ? [prefix, archiveName].join('/') : archiveName;

        return `{"bucket":"${bucket}","key":"${key}"}`;
      },

      _pack: function() {
        return new RSVP.Promise((resolve, reject) => {
          var distDir = this.readConfig('distDir');
          var archivePath = this.readConfig('archivePath');
          var archiveType = this.readConfig('archiveType');

          fs.mkdirsSync(archivePath);

          var archiveName = this._buildArchiveName();
          var fileName = path.join(archivePath, archiveName);

          this.log(`saving deploy archive to ${fileName}`, {
            verbose: true
          });

          var output = fs.createWriteStream(fileName);

          var archive = archiver(archiveType, { zlib: { level: 9 } });

          archive.pipe(output);

          var deployArchive = this.readConfig('deployArchive');
          archive.directory(distDir, deployArchive).finalize();

          output.on('close', function() {
            resolve();
          });

          archive.on('error', function(err) {
            reject(err);
          });
        });
      },

      _buildArchiveName: function() {
        var deployArchive = this.readConfig('deployArchive');
        var revisionKey = this.readConfig('revisionKey');
        var archiveType = this.readConfig('archiveType');
        return `${deployArchive}-${revisionKey}.${archiveType}`;
      },

      _errorMessage: function(error) {
        this.log(error, { color: 'red' });
        if (error) {
          this.log(error.stack, { color: 'red' });
        }
        return RSVP.Promise.reject(error);
      }
    });

    return new DeployPlugin();
  }
};
