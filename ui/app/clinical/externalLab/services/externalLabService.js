'use strict';

// Thin wrapper around the external-lab capture endpoints exposed by
// primecare-integrations under /v1/external-lab. The proxy is expected
// to forward /primecare-integrations/* to the integration service.
//
// Auth: the request carries the user's existing Bahmni session cookie
// (the integration service validates it back against OpenMRS), so no
// extra headers are required. Mirrors the pattern used by claimsService.js
// (see ui/app/claims/controllers/claimsService.js).

angular.module('bahmni.clinical')
    .service('externalLabService', ['$http', function ($http) {
        var BASE = '/primecare-integrations/v1/external-lab';

        // Request a lab requisition slip PDF for one or more lab orders
        // in the given visit. The endpoint streams `application/pdf`.
        this.requestSlip = function (visitUuid, orderUuids, externalLabId) {
            var body = { visitUuid: visitUuid };
            if (orderUuids && orderUuids.length) {
                body.orderUuids = orderUuids;
            }
            if (externalLabId) {
                body.externalLabId = externalLabId;
            }
            return $http.post(BASE + '/request-slip', body, {
                withCredentials: true,
                responseType: 'blob'
            });
        };

        // Upload one or more attachment files for an external-lab result.
        // `files` is an array of File objects from a <input type=file>.
        // Returns the underlying $http promise so the caller can wire up
        // progress / success / failure UI.
        this.uploadResult = function (params, files, onProgress) {
            var form = new FormData();
            form.append('visitUuid', params.visitUuid);
            form.append('patientUuid', params.patientUuid);
            if (params.orderUuid) {
                form.append('orderUuid', params.orderUuid);
            }
            if (params.note) {
                form.append('note', params.note);
            }
            angular.forEach(files || [], function (f) {
                form.append('file', f);
            });

            return $http.post(BASE + '/upload', form, {
                withCredentials: true,
                headers: { 'Content-Type': undefined }, // let browser set multipart boundary
                transformRequest: angular.identity,
                uploadEventHandlers: onProgress ? { progress: onProgress } : undefined
            });
        };

        // Post numeric obs (one or many concepts) onto a new encounter
        // tied to the given order, so the Bahmni trend graphs pick them up.
        this.postResults = function (orderUuid, obs) {
            return $http.post(BASE + '/results', {
                orderUuid: orderUuid,
                obs: obs
            }, {
                withCredentials: true
            });
        };

        // Client-side MIME whitelist mirroring the backend (saves a
        // round-trip on the upload path).
        this.allowedMimeTypes = [
            'application/pdf',
            'image/png',
            'image/jpeg',
            'image/tiff'
        ];

        this.maxFileSizeBytes = 10 * 1024 * 1024; // 10 MB cap, matches backend

        this.validateFile = function (file) {
            if (!file) { return 'No file selected'; }
            if (this.allowedMimeTypes.indexOf(file.type) < 0) {
                return 'Unsupported file type: ' + (file.type || 'unknown') +
                       '. Allowed: PDF, PNG, JPEG, TIFF.';
            }
            if (file.size > this.maxFileSizeBytes) {
                return 'File "' + file.name + '" exceeds the 10 MB limit.';
            }
            return null;
        };
    }]);
