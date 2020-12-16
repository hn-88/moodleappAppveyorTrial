// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Injectable } from '@angular/core';
import { HttpResponse, HttpParams } from '@angular/common/http';

import { FileEntry } from '@ionic-native/file';
import { FileUploadOptions } from '@ionic-native/file-transfer/ngx';
import { Md5 } from 'ts-md5/dist/md5';
import { Observable } from 'rxjs';
import { timeout } from 'rxjs/operators';

import { CoreNativeToAngularHttpResponse } from '@classes/native-to-angular-http';
import { CoreApp } from '@services/app';
import { CoreFile, CoreFileFormat } from '@services/file';
import { CoreMimetypeUtils } from '@services/utils/mimetype';
import { CoreTextUtils } from '@services/utils/text';
import { CoreUtils, PromiseDefer } from '@services/utils/utils';
import { CoreConstants } from '@/core/constants';
import { CoreError } from '@classes/errors/error';
import { CoreInterceptor } from '@classes/interceptor';
import { makeSingleton, Translate, FileTransfer, Http, Platform, NativeHttp } from '@singletons';
import { CoreArray } from '@singletons/array';
import { CoreLogger } from '@singletons/logger';
import { CoreWSError } from '@classes/errors/wserror';
import { CoreAjaxError } from '@classes/errors/ajaxerror';
import { CoreAjaxWSError } from '@classes/errors/ajaxwserror';

/**
 * This service allows performing WS calls and download/upload files.
 */
@Injectable({ providedIn: 'root' })
export class CoreWSProvider {

    protected logger: CoreLogger;
    protected mimeTypeCache: {[url: string]: string | null} = {}; // A "cache" to store file mimetypes to decrease HEAD requests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected ongoingCalls: {[queueItemId: string]: Promise<any>} = {};
    protected retryCalls: RetryCall[] = [];
    protected retryTimeout = 0;

    constructor() {
        this.logger = CoreLogger.getInstance('CoreWSProvider');

        this.init();
    }

    /**
     * Initialize some data.
     */
    protected async init(): Promise<void> {
        await Platform.instance.ready();

        if (CoreApp.instance.isIOS()) {
            NativeHttp.instance.setHeader('*', 'User-Agent', navigator.userAgent);
        }
    }

    /**
     * Adds the call data to an special queue to be processed when retrying.
     *
     * @param method The WebService method to be called.
     * @param siteUrl Complete site url to perform the call.
     * @param ajaxData Arguments to pass to the method.
     * @param preSets Extra settings and information.
     * @return Deferred promise resolved with the response data in success and rejected with the error if it fails.
     */
    protected addToRetryQueue<T = unknown>(method: string, siteUrl: string, data: unknown, preSets: CoreWSPreSets): Promise<T> {
        const call = {
            method,
            siteUrl,
            data,
            preSets,
            deferred: CoreUtils.instance.promiseDefer<T>(),
        };

        this.retryCalls.push(call);

        return call.deferred.promise;
    }

    /**
     * A wrapper function for a moodle WebService call.
     *
     * @param method The WebService method to be called.
     * @param data Arguments to pass to the method. It's recommended to call convertValuesToString before passing the data.
     * @param preSets Extra settings and information.
     * @return Promise resolved with the response data in success and rejected if it fails.
     */
    call<T = unknown>(method: string, data: unknown, preSets: CoreWSPreSets): Promise<T> {
        if (!preSets) {
            throw new CoreError(Translate.instance.instant('core.unexpectederror'));
        } else if (!CoreApp.instance.isOnline()) {
            throw new CoreError(Translate.instance.instant('core.networkerrormsg'));
        }

        preSets.typeExpected = preSets.typeExpected || 'object';
        if (typeof preSets.responseExpected == 'undefined') {
            preSets.responseExpected = true;
        }

        const dataToSend = Object.assign({}, data); // Create a new object so the changes don't affect the original data.
        dataToSend['wsfunction'] = method;
        dataToSend['wstoken'] = preSets.wsToken;
        const siteUrl = preSets.siteUrl + '/webservice/rest/server.php?moodlewsrestformat=json';

        // There are some ongoing retry calls, wait for timeout.
        if (this.retryCalls.length > 0) {
            this.logger.warn('Calls locked, trying later...');

            return this.addToRetryQueue<T>(method, siteUrl, dataToSend, preSets);
        } else {
            return this.performPost<T>(method, siteUrl, dataToSend, preSets);
        }
    }

    /**
     * Call a Moodle WS using the AJAX API. Please use it if the WS layer is not an option.
     * It uses a cache to prevent duplicate requests.
     *
     * @param method The WebService method to be called.
     * @param data Arguments to pass to the method.
     * @param preSets Extra settings and information. Only some
     * @return Promise resolved with the response data in success and rejected with CoreAjaxError.
     */
    callAjax<T = unknown>(method: string, data: Record<string, unknown>, preSets: CoreWSAjaxPreSets): Promise<T> {
        const cacheParams = {
            methodname: method,
            args: data,
        };

        let promise = this.getPromiseHttp<T>('ajax', preSets.siteUrl, cacheParams);

        if (!promise) {
            promise = this.performAjax<T>(method, data, preSets);
            promise = this.setPromiseHttp<T>(promise, 'ajax', preSets.siteUrl, cacheParams);
        }

        return promise;
    }

    /**
     * Converts an objects values to strings where appropriate.
     * Arrays (associative or otherwise) will be maintained, null values will be removed.
     *
     * @param data The data that needs all the non-object values set to strings.
     * @param stripUnicode If Unicode long chars need to be stripped.
     * @return The cleaned object or null if some strings becomes empty after stripping Unicode.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    convertValuesToString(data: any, stripUnicode?: boolean): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = Array.isArray(data) ? [] : {};

        for (const key in data) {
            let value = data[key];

            if (value == null) {
                // Skip null or undefined value.
                continue;
            } else if (typeof value == 'object') {
                // Object or array.
                value = this.convertValuesToString(value, stripUnicode);
                if (value == null) {
                    return null;
                }
            } else if (typeof value == 'string') {
                if (stripUnicode) {
                    const stripped = CoreTextUtils.instance.stripUnicode(value);
                    if (stripped != value && stripped.trim().length == 0) {
                        return null;
                    }
                    value = stripped;
                }
            } else if (typeof value == 'boolean') {
                /* Moodle does not allow "true" or "false" in WS parameters, only in POST parameters.
                   We've been using "true" and "false" for WS settings "filter" and "fileurl",
                   we keep it this way to avoid changing cache keys. */
                if (key == 'moodlewssettingfilter' || key == 'moodlewssettingfileurl') {
                    value = value ? 'true' : 'false';
                } else {
                    value = value ? '1' : '0';
                }
            } else if (typeof value == 'number') {
                value = String(value);
            } else {
                // Unknown type.
                continue;
            }

            if (Array.isArray(result)) {
                result.push(value);
            } else {
                result[key] = value;
            }
        }

        return result;
    }

    /**
     * Create a "fake" WS error for local errors.
     *
     * @param message The message to include in the error.
     * @param needsTranslate If the message needs to be translated.
     * @param translateParams Translation params, if needed.
     * @return Fake WS error.
     * @deprecated since 3.9.5. Just create the error directly.
     */
    createFakeWSError(message: string, needsTranslate?: boolean, translateParams?: {[name: string]: string}): CoreError {
        if (needsTranslate) {
            message = Translate.instance.instant(message, translateParams);
        }

        return new CoreError(message);
    }

    /**
     * Downloads a file from Moodle using Cordova File API.
     *
     * @param url Download url.
     * @param path Local path to store the file.
     * @param addExtension True if extension need to be added to the final path.
     * @param onProgress Function to call on progress.
     * @return Promise resolved with the downloaded file.
     */
    async downloadFile(
        url: string,
        path: string,
        addExtension?: boolean,
        onProgress?: (event: ProgressEvent) => void,
    ): Promise<CoreWSDownloadedFileEntry> {
        this.logger.debug('Downloading file', url, path, addExtension);

        if (!CoreApp.instance.isOnline()) {
            throw new CoreError(Translate.instance.instant('core.networkerrormsg'));
        }

        // Use a tmp path to download the file and then move it to final location.
        // This is because if the download fails, the local file is deleted.
        const tmpPath = path + '.tmp';

        try {
            // Create the tmp file as an empty file.
            const fileEntry = await CoreFile.instance.createFile(tmpPath);

            const transfer = FileTransfer.instance.create();
            onProgress && transfer.onProgress(onProgress);

            // Download the file in the tmp file.
            await transfer.download(url, fileEntry.toURL(), true);

            let extension = '';

            if (addExtension) {
                extension = CoreMimetypeUtils.instance.getFileExtension(path) || '';

                // Google Drive extensions will be considered invalid since Moodle usually converts them.
                if (!extension || CoreArray.contains(['gdoc', 'gsheet', 'gslides', 'gdraw', 'php'], extension)) {
                    // Not valid, get the file's mimetype.
                    const mimetype = await this.getRemoteFileMimeType(url);

                    if (mimetype) {
                        const remoteExtension = CoreMimetypeUtils.instance.getExtension(mimetype, url);
                        // If the file is from Google Drive, ignore mimetype application/json.
                        if (remoteExtension && (!extension || mimetype != 'application/json')) {
                            if (extension) {
                                // Remove existing extension since we will use another one.
                                path = CoreMimetypeUtils.instance.removeExtension(path);
                            }
                            path += '.' + remoteExtension;

                            extension = remoteExtension;
                        }
                    }
                }
            }

            // Move the file to the final location.
            const movedEntry = await CoreFile.instance.moveFile(tmpPath, path);

            this.logger.debug(`Success downloading file ${url} to ${path} with extension ${extension}`);

            // Also return the extension and path.
            return <CoreWSDownloadedFileEntry> Object.assign(movedEntry, {
                extension: extension,
                path: path,
            });
        } catch (error) {
            this.logger.error(`Error downloading ${url} to ${path}`, error);

            throw error;
        }
    }

    /**
     * Get a promise from the cache.
     *
     * @param method Method of the HTTP request.
     * @param url Base URL of the HTTP request.
     * @param params Params of the HTTP request.
     */
    protected getPromiseHttp<T = unknown>(method: string, url: string, params?: Record<string, unknown>): Promise<T> | undefined {
        const queueItemId = this.getQueueItemId(method, url, params);
        if (typeof this.ongoingCalls[queueItemId] != 'undefined') {
            return this.ongoingCalls[queueItemId];
        }
    }

    /**
     * Perform a HEAD request to get the mimetype of a remote file.
     *
     * @param url File URL.
     * @param ignoreCache True to ignore cache, false otherwise.
     * @return Promise resolved with the mimetype or '' if failure.
     */
    async getRemoteFileMimeType(url: string, ignoreCache?: boolean): Promise<string> {
        if (this.mimeTypeCache[url] && !ignoreCache) {
            return this.mimeTypeCache[url]!;
        }

        try {
            const response = await this.performHead(url);

            let mimeType = response.headers.get('Content-Type');
            if (mimeType) {
                // Remove "parameters" like charset.
                mimeType = mimeType.split(';')[0];
            }
            this.mimeTypeCache[url] = mimeType;

            return mimeType || '';
        } catch (error) {
            // Error, resolve with empty mimetype.
            return '';
        }
    }

    /**
     * Perform a HEAD request to get the size of a remote file.
     *
     * @param url File URL.
     * @return Promise resolved with the size or -1 if failure.
     */
    getRemoteFileSize(url: string): Promise<number> {
        return this.performHead(url).then((response) => {
            const contentLength = response.headers.get('Content-Length');
            const size = contentLength ? parseInt(contentLength, 10) : 0;

            if (size) {
                return size;
            }

            return -1;
        }).catch(() => -1);
    }

    /**
     * Get a request timeout based on the network connection.
     *
     * @return Timeout in ms.
     */
    getRequestTimeout(): number {
        return CoreApp.instance.isNetworkAccessLimited() ? CoreConstants.WS_TIMEOUT : CoreConstants.WS_TIMEOUT_WIFI;
    }

    /**
     * Get the unique queue item id of the cache for a HTTP request.
     *
     * @param method Method of the HTTP request.
     * @param url Base URL of the HTTP request.
     * @param params Params of the HTTP request.
     * @return Queue item ID.
     */
    protected getQueueItemId(method: string, url: string, params?: Record<string, unknown>): string {
        if (params) {
            url += '###' + CoreInterceptor.serialize(params);
        }

        return method + '#' + Md5.hashAsciiStr(url);
    }

    /**
     * Call a Moodle WS using the AJAX API.
     *
     * @param method The WebService method to be called.
     * @param data Arguments to pass to the method.
     * @param preSets Extra settings and information. Only some
     * @return Promise resolved with the response data in success and rejected with CoreAjaxError.
     */
    protected performAjax<T = unknown>(method: string, data: Record<string, unknown>, preSets: CoreWSAjaxPreSets): Promise<T> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let promise: Promise<HttpResponse<any>>;

        if (typeof preSets.siteUrl == 'undefined') {
            throw new CoreAjaxError(Translate.instance.instant('core.unexpectederror'));
        } else if (!CoreApp.instance.isOnline()) {
            throw new CoreAjaxError(Translate.instance.instant('core.networkerrormsg'));
        }

        if (typeof preSets.responseExpected == 'undefined') {
            preSets.responseExpected = true;
        }

        const script = preSets.noLogin ? 'service-nologin.php' : 'service.php';
        const ajaxData = [{
            index: 0,
            methodname: method,
            args: this.convertValuesToString(data),
        }];

        // The info= parameter has no function. It is just to help with debugging.
        // We call it info to match the parameter name use by Moodle's AMD ajax module.
        let siteUrl = preSets.siteUrl + '/lib/ajax/' + script + '?info=' + method;

        if (preSets.noLogin && preSets.useGet) {
            // Send params using GET.
            siteUrl += '&args=' + encodeURIComponent(JSON.stringify(ajaxData));

            promise = this.sendHTTPRequest<T>(siteUrl, {
                method: 'get',
            });
        } else {
            promise = this.sendHTTPRequest<T>(siteUrl, {
                method: 'post',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: <any> ajaxData,
                serializer: 'json',
            });
        }

        return promise.then((response) => {
            let data = response.body;

            // Some moodle web services return null.
            // If the responseExpected value is set then so long as no data is returned, we create a blank object.
            if (!data && !preSets.responseExpected) {
                data = [{}];
            }

            // Check if error. Ajax layer should always return an object (if error) or an array (if success).
            if (!data || typeof data != 'object') {
                throw new CoreAjaxError(Translate.instance.instant('core.serverconnection'));
            } else if (data.error) {
                throw new CoreAjaxWSError(data);
            }

            // Get the first response since only one request was done.
            data = data[0];

            if (data.error) {
                throw new CoreAjaxWSError(data.exception);
            }

            return data.data;
        }, (data) => {
            const available = data.status == 404 ? -1 : 0;

            throw new CoreAjaxError(Translate.instance.instant('core.serverconnection'), available);
        });
    }

    /**
     * Perform a HEAD request and save the promise while waiting to be resolved.
     *
     * @param url URL to perform the request.
     * @return Promise resolved with the response.
     */
    performHead<T = unknown>(url: string): Promise<HttpResponse<T>> {
        let promise = this.getPromiseHttp<HttpResponse<T>>('head', url);

        if (!promise) {
            promise = this.sendHTTPRequest<T>(url, {
                method: 'head',
                responseType: 'text',
            });

            promise = this.setPromiseHttp<HttpResponse<T>>(promise, 'head', url);
        }

        return promise;
    }

    /**
     * Perform the post call and save the promise while waiting to be resolved.
     *
     * @param method The WebService method to be called.
     * @param siteUrl Complete site url to perform the call.
     * @param ajaxData Arguments to pass to the method.
     * @param preSets Extra settings and information.
     * @return Promise resolved with the response data in success and rejected with CoreWSError if it fails.
     */
    performPost<T = unknown>(method: string, siteUrl: string, ajaxData: unknown, preSets: CoreWSPreSets): Promise<T> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const options: any = {};

        // This is done because some returned values like 0 are treated as null if responseType is json.
        if (preSets.typeExpected == 'number' || preSets.typeExpected == 'boolean' || preSets.typeExpected == 'string') {
            options.responseType = 'text';
        }

        // We add the method name to the URL purely to help with debugging.
        // This duplicates what is in the ajaxData, but that does no harm.
        // POST variables take precedence over GET.
        const requestUrl = siteUrl + '&wsfunction=' + method;

        // Perform the post request.
        const promise = Http.instance.post(requestUrl, ajaxData, options).pipe(timeout(this.getRequestTimeout())).toPromise();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return promise.then((data: any) => {
            // Some moodle web services return null.
            // If the responseExpected value is set to false, we create a blank object if the response is null.
            if (!data && !preSets.responseExpected) {
                data = {};
            }

            if (!data) {
                throw new CoreError(Translate.instance.instant('core.serverconnection'));
            } else if (typeof data != preSets.typeExpected) {
                // If responseType is text an string will be returned, parse before returning.
                if (typeof data == 'string') {
                    if (preSets.typeExpected == 'number') {
                        data = Number(data);
                        if (isNaN(data)) {
                            this.logger.warn(`Response expected type "${preSets.typeExpected}" cannot be parsed to number`);

                            throw new CoreError(Translate.instance.instant('core.errorinvalidresponse'));
                        }
                    } else if (preSets.typeExpected == 'boolean') {
                        if (data === 'true') {
                            data = true;
                        } else if (data === 'false') {
                            data = false;
                        } else {
                            this.logger.warn(`Response expected type "${preSets.typeExpected}" is not true or false`);

                            throw new CoreError(Translate.instance.instant('core.errorinvalidresponse'));
                        }
                    } else {
                        this.logger.warn('Response of type "' + typeof data + `" received, expecting "${preSets.typeExpected}"`);

                        throw new CoreError(Translate.instance.instant('core.errorinvalidresponse'));
                    }
                } else {
                    this.logger.warn('Response of type "' + typeof data + `" received, expecting "${preSets.typeExpected}"`);

                    throw new CoreError(Translate.instance.instant('core.errorinvalidresponse'));
                }
            }

            if (typeof data.exception !== 'undefined') {
                // Special debugging for site plugins, otherwise it's hard to debug errors if the data is cached.
                if (method == 'tool_mobile_get_content') {
                    this.logger.error('Error calling WS', method, data);
                }

                throw new CoreWSError(data);
            }

            if (typeof data.debuginfo != 'undefined') {
                throw new CoreError('Error. ' + data.message);
            }

            return data;
        }, (error) => {
            // If server has heavy load, retry after some seconds.
            if (error.status == 429) {
                const retryPromise = this.addToRetryQueue<T>(method, siteUrl, ajaxData, preSets);

                // Only process the queue one time.
                if (this.retryTimeout == 0) {
                    this.retryTimeout = parseInt(error.headers.get('Retry-After'), 10) || 5;
                    this.logger.warn(`${error.statusText}. Retrying in ${this.retryTimeout} seconds. ` +
                        `${this.retryCalls.length} calls left.`);

                    setTimeout(() => {
                        this.logger.warn(`Retrying now with ${this.retryCalls.length} calls to process.`);
                        // Finish timeout.
                        this.retryTimeout = 0;
                        this.processRetryQueue();
                    }, this.retryTimeout * 1000);
                } else {
                    this.logger.warn('Calls locked, trying later...');
                }

                return retryPromise;
            }

            throw new CoreError(Translate.instance.instant('core.serverconnection'));
        });
    }

    /**
     * Retry all requests in the queue.
     * This function uses recursion in order to add a delay between requests to reduce stress.
     */
    protected processRetryQueue(): void {
        if (this.retryCalls.length > 0 && this.retryTimeout == 0) {
            const call = this.retryCalls.shift();
            // Add a delay between calls.
            setTimeout(() => {
                call!.deferred.resolve(this.performPost(call!.method, call!.siteUrl, call!.data, call!.preSets));
                this.processRetryQueue();
            }, 200);
        } else {
            this.logger.warn(`Retry queue has stopped with ${this.retryCalls.length} calls and ${this.retryTimeout} timeout secs.`);
        }
    }

    /**
     * Save promise on the cache.
     *
     * @param promise Promise to be saved.
     * @param method Method of the HTTP request.
     * @param url Base URL of the HTTP request.
     * @param params Params of the HTTP request.
     * @return The promise saved.
     */
    protected setPromiseHttp<T = unknown>(
        promise: Promise<T>,
        method: string,
        url: string,
        params?: Record<string, unknown>,
    ): Promise<T> {
        const queueItemId = this.getQueueItemId(method, url, params);

        this.ongoingCalls[queueItemId] = promise;

        // HTTP not finished, but we should delete the promise after timeout.
        const timeout = setTimeout(() => {
            delete this.ongoingCalls[queueItemId];
        }, this.getRequestTimeout());

        // HTTP finished, delete from ongoing.
        return promise.finally(() => {
            delete this.ongoingCalls[queueItemId];

            clearTimeout(timeout);
        });
    }

    /**
     * A wrapper function for a synchronous Moodle WebService call.
     * Warning: This function should only be used if synchronous is a must. It's recommended to use call.
     *
     * @param method The WebService method to be called.
     * @param data Arguments to pass to the method.
     * @param preSets Extra settings and information.
     * @return Promise resolved with the response data in success and rejected with the error message if it fails.
     * @return Request response.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    syncCall<T = unknown>(method: string, data: any, preSets: CoreWSPreSets): T {
        if (!preSets) {
            throw new CoreError(Translate.instance.instant('core.unexpectederror'));
        } else if (!CoreApp.instance.isOnline()) {
            throw new CoreError(Translate.instance.instant('core.networkerrormsg'));
        }

        preSets.typeExpected = preSets.typeExpected || 'object';
        if (typeof preSets.responseExpected == 'undefined') {
            preSets.responseExpected = true;
        }

        data = this.convertValuesToString(data || {}, preSets.cleanUnicode);
        if (data == null) {
            // Empty cleaned text found.
            throw new CoreError(Translate.instance.instant('core.unicodenotsupportedcleanerror'));
        }

        data.wsfunction = method;
        data.wstoken = preSets.wsToken;
        const siteUrl = preSets.siteUrl + '/webservice/rest/server.php?moodlewsrestformat=json';

        // Serialize data.
        data = CoreInterceptor.serialize(data);

        // Perform sync request using XMLHttpRequest.
        const xhr = new XMLHttpRequest();
        xhr.open('post', siteUrl, false);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded;charset=utf-8');

        xhr.send(data);

        // Get response.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data = ('response' in xhr) ? xhr.response : (<any> xhr).responseText;

        // Check status.
        const status = Math.max(xhr.status === 1223 ? 204 : xhr.status, 0);
        if (status < 200 || status >= 300) {
            // Request failed.
            throw new CoreError(data);
        }

        // Treat response.
        data = CoreTextUtils.instance.parseJSON(data);

        // Some moodle web services return null.
        // If the responseExpected value is set then so long as no data is returned, we create a blank object.
        if ((!data || !data.data) && !preSets.responseExpected) {
            data = {};
        }

        if (!data) {
            throw new CoreError(Translate.instance.instant('core.serverconnection'));
        } else if (typeof data != preSets.typeExpected) {
            this.logger.warn('Response of type "' + typeof data + '" received, expecting "' + preSets.typeExpected + '"');
            throw new CoreError(Translate.instance.instant('core.errorinvalidresponse'));
        }

        if (typeof data.exception != 'undefined' || typeof data.debuginfo != 'undefined') {
            throw new CoreWSError(data);
        }

        return data;
    }

    /*
     * Uploads a file.
     *
     * @param filePath File path.
     * @param options File upload options.
     * @param preSets Must contain siteUrl and wsToken.
     * @param onProgress Function to call on progress.
     * @return Promise resolved when uploaded.
     */
    async uploadFile(
        filePath: string,
        options: CoreWSFileUploadOptions,
        preSets: CoreWSPreSets,
        onProgress?: (event: ProgressEvent) => void,
    ): Promise<CoreWSUploadFileResult> {
        this.logger.debug(`Trying to upload file: ${filePath}`);

        if (!filePath || !options || !preSets) {
            throw new CoreError('Invalid options passed to upload file.');
        }

        if (!CoreApp.instance.isOnline()) {
            throw new CoreError(Translate.instance.instant('core.networkerrormsg'));
        }

        const uploadUrl = preSets.siteUrl + '/webservice/upload.php';
        const transfer = FileTransfer.instance.create();

        onProgress && transfer.onProgress(onProgress);

        options.httpMethod = 'POST';
        options.params = {
            token: preSets.wsToken,
            filearea: options.fileArea || 'draft',
            itemid: options.itemId || 0,
        };
        options.chunkedMode = false;
        options.headers = {};
        options['Connection'] = 'close';

        try {
            const success = await transfer.upload(filePath, uploadUrl, options, true);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = CoreTextUtils.instance.parseJSON<any>(
                success.response,
                null,
                this.logger.error.bind(this.logger, 'Error parsing response from upload', success.response),
            );

            if (data === null) {
                throw new CoreError(Translate.instance.instant('core.errorinvalidresponse'));
            }

            if (!data) {
                throw new CoreError(Translate.instance.instant('core.serverconnection'));
            } else if (typeof data != 'object') {
                this.logger.warn('Upload file: Response of type "' + typeof data + '" received, expecting "object"');

                throw new CoreError(Translate.instance.instant('core.errorinvalidresponse'));
            }

            if (typeof data.exception !== 'undefined') {
                throw new CoreWSError(data);
            } else if (typeof data.error !== 'undefined') {
                throw new CoreWSError({
                    errorcode: data.errortype,
                    message: data.error,
                });
            } else if (data[0] && typeof data[0].error !== 'undefined') {
                throw new CoreWSError({
                    errorcode: data[0].errortype,
                    message: data[0].error,
                });
            }

            // We uploaded only 1 file, so we only return the first file returned.
            this.logger.debug('Successfully uploaded file', filePath);

            return data[0];
        } catch (error) {
            this.logger.error('Error while uploading file', filePath, error);

            throw new CoreError(Translate.instance.instant('core.errorinvalidresponse'));
        }
    }

    /**
     * Perform an HTTP request requesting for a text response.
     *
     * @param  url Url to get.
     * @return Resolved with the text when done.
     */
    async getText(url: string): Promise<string> {
        // Fetch the URL content.
        const options: HttpRequestOptions = {
            method: 'get',
            responseType: 'text',
        };

        const response = await this.sendHTTPRequest<string>(url, options);

        const content = response.body;

        if (typeof content !== 'string') {
            throw new Error('Error reading content');
        }

        return content;
    }

    /**
     * Send an HTTP request. In mobile devices it will use the cordova plugin.
     *
     * @param url URL of the request.
     * @param options Options for the request.
     * @return Promise resolved with the response.
     */
    async sendHTTPRequest<T = unknown>(url: string, options: HttpRequestOptions): Promise<HttpResponse<T>> {
        // Set default values.
        options.responseType = options.responseType || 'json';
        options.timeout = typeof options.timeout == 'undefined' ? this.getRequestTimeout() : options.timeout;

        if (CoreApp.instance.isIOS()) {
            // Use the cordova plugin.
            if (url.indexOf('file://') === 0) {
                // We cannot load local files using the http native plugin. Use file provider instead.
                const content = options.responseType == 'json' ?
                    await CoreFile.instance.readFile<T>(url, CoreFileFormat.FORMATJSON) :
                    await CoreFile.instance.readFile(url, CoreFileFormat.FORMATTEXT);

                return new HttpResponse<T>({
                    body: <T> content,
                    headers: undefined,
                    status: 200,
                    statusText: 'OK',
                    url,
                });
            }

            return NativeHttp.instance.sendRequest(url, options).then((response) => new CoreNativeToAngularHttpResponse(response));
        } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let observable: Observable<HttpResponse<any>>;
            const angularOptions = <AngularHttpRequestOptions> options;

            // Use Angular's library.
            switch (angularOptions.method) {
                case 'get':
                    observable = Http.instance.get(url, {
                        headers: angularOptions.headers,
                        params: angularOptions.params,
                        observe: 'response',
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        responseType: <any> angularOptions.responseType,
                    });
                    break;

                case 'post':
                    if (angularOptions.serializer == 'json') {
                        angularOptions.data = JSON.stringify(angularOptions.data);
                    }

                    observable = Http.instance.post(url, angularOptions.data, {
                        headers: angularOptions.headers,
                        observe: 'response',
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        responseType: <any> angularOptions.responseType,
                    });
                    break;

                case 'head':
                    observable = Http.instance.head(url, {
                        headers: angularOptions.headers,
                        observe: 'response',
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        responseType: <any> angularOptions.responseType,
                    });
                    break;

                default:
                    throw new CoreError('Method not implemented yet.');
            }

            if (angularOptions.timeout) {
                observable = observable.pipe(timeout(angularOptions.timeout));
            }

            return observable.toPromise();
        }
    }

    /**
     * Check if a URL works (it returns a 2XX status).
     *
     * @param url URL to check.
     * @return Promise resolved with boolean: whether it works.
     */
    async urlWorks(url: string): Promise<boolean> {
        try {
            const result = await this.performHead(url);

            return result.status >= 200 && result.status < 300;
        } catch (error) {
            return false;
        }
    }

}

export class CoreWS extends makeSingleton(CoreWSProvider) {}

/**
 * File upload options.
 */
export interface CoreWSFileUploadOptions extends FileUploadOptions {
    /**
     * The file area where to put the file. By default, 'draft'.
     */
    fileArea?: string;

    /**
     * Item ID of the area where to put the file. By default, 0.
     */
    itemId?: number;
}

/**
 * Structure of warnings returned by WS.
 */
export type CoreWSExternalWarning = {
    /**
     * Item.
     */
    item?: string;

    /**
     * Item id.
     */
    itemid?: number;

    /**
     * The warning code can be used by the client app to implement specific behaviour.
     */
    warningcode: string;

    /**
     * Untranslated english message to explain the warning.
     */
    message: string;

};

/**
 * Special response structure of many webservices that contains success status and warnings.
 */
export type CoreStatusWithWarningsWSResponse = {
    status: boolean; // Status: true if success.
    offline?: boolean; // True if information has been stored in offline for future use.
    warnings?: CoreWSExternalWarning[];
};

/**
 * Special response structure of many webservices that contains only warnings.
 */
export type CoreWarningsWSResponse = {
    warnings?: CoreWSExternalWarning[];
};

/**
 * Structure of files returned by WS.
 */
export type CoreWSExternalFile = {
    /**
     * Downloadable file url.
     */
    fileurl: string;

    /**
     * File name.
     */
    filename?: string;

    /**
     * File path.
     */
    filepath?: string;

    /**
     * File size.
     */
    filesize?: number;

    /**
     * Time modified.
     */
    timemodified?: number;

    /**
     * File mime type.
     */
    mimetype?: string;

    /**
     * Whether is an external file.
     */
    isexternalfile?: number;

    /**
     * The repository type for external files.
     */
    repositorytype?: string;

};

/**
 * Data returned by date_exporter.
 */
export type CoreWSDate = {
    seconds: number; // Seconds.
    minutes: number; // Minutes.
    hours: number; // Hours.
    mday: number; // Mday.
    wday: number; // Wday.
    mon: number; // Mon.
    year: number; // Year.
    yday: number; // Yday.
    weekday: string; // Weekday.
    month: string; // Month.
    timestamp: number; // Timestamp.
};


/**
 * PreSets accepted by the WS call.
 */
export type CoreWSPreSets = {
    /**
     * The site URL.
     */
    siteUrl: string;

    /**
     * The Webservice token.
     */
    wsToken: string;

    /**
     * Defaults to true. Set to false when the expected response is null.
     */
    responseExpected?: boolean;

    /**
     * Defaults to 'object'. Use it when you expect a type that's not an object|array.
     */
    typeExpected?: string;

    /**
     * Defaults to false. Clean multibyte Unicode chars from data.
     */
    cleanUnicode?: boolean;
};

/**
 * PreSets accepted by AJAX WS calls.
 */
export type CoreWSAjaxPreSets = {
    /**
     * The site URL.
     */
    siteUrl: string;

    /**
     * Defaults to true. Set to false when the expected response is null.
     */
    responseExpected?: boolean;

    /**
     * Whether to use the no-login endpoint instead of the normal one. Use it for requests that don't require authentication.
     */
    noLogin?: boolean;

    /**
     * Whether to send the parameters via GET. Only if noLogin is true.
     */
    useGet?: boolean;
};

/**
 * Options for HTTP requests.
 */
export type HttpRequestOptions = {
    /**
     * The HTTP method.
     */
    method: 'get' | 'post' | 'put' | 'patch' | 'head' | 'delete' | 'options' | 'upload' | 'download';

    /**
     * Payload to send to the server. Only applicable on post, put or patch methods.
     */
    data?: Record<string, unknown>;

    /**
     * Query params to be appended to the URL (only applicable on get, head, delete, upload or download methods).
     */
    params?: Record<string, string | number>;

    /**
     * Response type. Defaults to json.
     */
    responseType?: 'json' | 'text' | 'arraybuffer' | 'blob';

    /**
     * Timeout for the request in seconds. If undefined, the default value will be used. If null, no timeout.
     */
    timeout?: number;

    /**
     * Serializer to use. Defaults to 'urlencoded'. Only for mobile environments.
     */
    serializer?: 'json' | 'urlencoded' | 'utf8' | 'multipart';

    /**
     * Whether to follow redirects. Defaults to true. Only for mobile environments.
     */
    followRedirect?: boolean;

    /**
     * Headers. Only for mobile environments.
     */
    headers?: Record<string, string>;

    /**
     * File paths to use for upload or download. Only for mobile environments.
     */
    filePath?: string | string[];

    /**
     * Name to use during upload. Only for mobile environments.
     */
    name?: string | string[];
};

/**
 * Options for JSON HTTP requests using Angular Http.
 */
type AngularHttpRequestOptions = Omit<HttpRequestOptions, 'data'|'params'> & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: Record<string, any> | string;
    params?: HttpParams | {
        [param: string]: string | string[];
    };
};

/**
 * Data needed to retry a WS call.
 */
type RetryCall = {
    method: string;
    siteUrl: string;
    data: unknown;
    preSets: CoreWSPreSets;
    deferred: PromiseDefer<unknown>;
};

/**
 * Downloaded file entry. It includes some calculated data.
 */
export type CoreWSDownloadedFileEntry = FileEntry & {
    extension: string; // File extension.
    path: string; // File path.
};

export type CoreWSUploadFileResult = {
    component: string; // Component the file was uploaded to.
    context: string; // Context the file was uploaded to.
    userid: number; // User that uploaded the file.
    filearea: string; // File area the file was uploaded to.
    filename: string; // File name.
    filepath: string; // File path.
    itemid: number; // Item ID the file was uploaded to.
    license: string; // File license.
    author: string; // Author name.
    source: string; // File source.
};
