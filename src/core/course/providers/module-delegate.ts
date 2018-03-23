// (C) Copyright 2015 Martin Dougiamas
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

import { Injectable, Injector } from '@angular/core';
import { NavController, NavOptions } from 'ionic-angular';
import { CoreEventsProvider } from '@providers/events';
import { CoreLoggerProvider } from '@providers/logger';
import { CoreSitesProvider } from '@providers/sites';
import { CoreCourseProvider } from './course';
import { CoreSite } from '@classes/site';
import { CoreDelegate, CoreDelegateHandler } from '@classes/delegate';

/**
 * Interface that all course module handlers must implement.
 */
export interface CoreCourseModuleHandler extends CoreDelegateHandler {
    /**
     * Get the data required to display the module in the course contents view.
     *
     * @param {any} module The module object.
     * @param {number} courseId The course ID.
     * @param {number} sectionId The section ID.
     * @return {CoreCourseModuleHandlerData} Data to render the module.
     */
    getData(module: any, courseId: number, sectionId: number): CoreCourseModuleHandlerData;

    /**
     * Get the component to render the module. This is needed to support singleactivity course format.
     * The component returned must implement CoreCourseModuleMainComponent.
     * It's recommended to return the class of the component, but you can also return an instance of the component.
     *
     * @param {Injector} injector Injector.
     * @param {any} course The course object.
     * @param {any} module The module object.
     * @return {any|Promise<any>} The component (or promise resolved with component) to use, undefined if not found.
     */
    getMainComponent(injector: Injector, course: any, module: any): any | Promise<any>;
}

/**
 * Data needed to render the module in course contents.
 */
export interface CoreCourseModuleHandlerData {
    /**
     * The title to display in the module.
     * @type {string}
     */
    title: string;

    /**
     * The image to use as icon (path to the image).
     * @type {string}
     */
    icon?: string;

    /**
     * The class to assign to the item.
     * @type {string}
     */
    class?: string;

    /**
     * Whether to display a button to download/refresh the module if it's downloadable.
     * If it's set to true, the app will show a download/refresh button when needed and will handle the download of the
     * module using CoreCourseModulePrefetchDelegate.
     * @type {boolean}
     */
    showDownloadButton?: boolean;

    /**
     * The buttons to display in the module item.
     * @type {CoreCourseModuleHandlerButton[]}
     */
    buttons?: CoreCourseModuleHandlerButton[];

    /**
     * Whether to display a spinner in the module item.
     * @type {boolean}
     */
    spinner?: boolean;

    /**
     * Action to perform when the module is clicked.
     *
     * @param {Event} event The click event.
     * @param {NavController} navCtrl NavController instance.
     * @param {any} module The module object.
     * @param {number} courseId The course ID.
     * @param {NavOptions} [options] Options for the navigation.
     */
    action?(event: Event, navCtrl: NavController, module: any, courseId: number, options?: NavOptions): void;
}

/**
 * Interface that all the components to render the module in singleactivity must implement.
 */
export interface CoreCourseModuleMainComponent {
    /**
     * Refresh the data.
     *
     * @param {any} [refresher] Refresher.
     * @param {Function} [done] Function to call when done.
     * @return {Promise<any>} Promise resolved when done.
     */
    doRefresh(refresher?: any, done?: () => void): Promise<any>;
}

/**
 * A button to display in a module item.
 */
export interface CoreCourseModuleHandlerButton {
    /**
     * The label to add to the button.
     * @type {string}
     */
    label: string;

    /**
     * The name of the button icon.
     * @type {string}
     */
    icon: string;

    /**
     * Whether the button should be hidden.
     * @type {boolean}
     */
    hidden?: boolean;

    /**
     * The name of the button icon to use in iOS instead of "icon".
     * @type {string}
     */
    iosIcon?: string;

    /**
     * The name of the button icon to use in MaterialDesign instead of "icon".
     * @type {string}
     */
    mdIcon?: string;

    /**
     * Action to perform when the button is clicked.
     *
     * @param {Event} event The click event.
     * @param {NavController} navCtrl NavController instance.
     * @param {any} module The module object.
     * @param {number} courseId The course ID.
     */
    action(event: Event, navCtrl: NavController, module: any, courseId: number): void;
}

/**
 * Delegate to register module handlers.
 */
@Injectable()
export class CoreCourseModuleDelegate extends CoreDelegate {
    protected handlers: { [s: string]: CoreCourseModuleHandler } = {}; // All registered handlers.
    protected enabledHandlers: { [s: string]: CoreCourseModuleHandler } = {}; // Handlers enabled for the current site.
    protected featurePrefix = 'CoreCourseModuleDelegate_';

    constructor(loggerProvider: CoreLoggerProvider, protected sitesProvider: CoreSitesProvider, eventsProvider: CoreEventsProvider,
            protected courseProvider: CoreCourseProvider) {
        super('CoreCourseModuleDelegate', loggerProvider, sitesProvider, eventsProvider);
    }

    /**
     * Get the component to render the module.
     *
     * @param {Injector} injector Injector.
     * @param {any} course The course object.
     * @param {any} module The module object.
     * @return {Promise<any>} Promise resolved with component to use, undefined if not found.
     */
    getMainComponent(injector: Injector, course: any, module: any): Promise<any> {
        const handler = this.enabledHandlers[module.modname];
        if (handler && handler.getMainComponent) {
            return Promise.resolve(handler.getMainComponent(injector, course, module)).catch((err) => {
                this.logger.error('Error getting main component', err);
            });
        }
    }

    /**
     * Get the data required to display the module in the course contents view.
     *
     * @param {string} modname The name of the module type.
     * @param {any} module The module object.
     * @param {number} courseId The course ID.
     * @param {number} sectionId The section ID.
     * @return {CoreCourseModuleHandlerData} Data to render the module.
     */
    getModuleDataFor(modname: string, module: any, courseId: number, sectionId: number): CoreCourseModuleHandlerData {
        if (typeof this.enabledHandlers[modname] != 'undefined') {
            return this.enabledHandlers[modname].getData(module, courseId, sectionId);
        }

        // Return the default data.
        const defaultData: CoreCourseModuleHandlerData = {
            icon: this.courseProvider.getModuleIconSrc(module.modname),
            title: module.name,
            class: 'core-course-default-handler core-course-module-' + module.modname + '-handler',
            action: (event: Event, navCtrl: NavController, module: any, courseId: number, options?: NavOptions): void => {
                event.preventDefault();
                event.stopPropagation();

                navCtrl.push('CoreCourseUnsupportedModulePage', { module: module }, options);
            }
        };

        if (module.url) {
            defaultData.buttons = [{
                icon: 'open',
                label: 'core.openinbrowser',
                action: (e: Event): void => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.sitesProvider.getCurrentSite().openInBrowserWithAutoLoginIfSameSite(module.url);
                }
            }];
        }

        return defaultData;
    }

    /**
     * Check if a certain module type is disabled in a site.
     *
     * @param {string} modname The name of the module type.
     * @param {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<boolean>} Promise resolved with boolean: whether module is disabled.
     */
    isModuleDisabled(modname: string, siteId?: string): Promise<boolean> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            return this.isModuleDisabledInSite(modname, site);
        });
    }

    /**
     * Check if a certain module type is disabled in a site.
     *
     * @param {string} modname The name of the module type.
     * @param {CoreSite} [site] Site. If not defined, use current site.
     * @return {boolean} Whether module is disabled.
     */
    isModuleDisabledInSite(modname: string, site?: CoreSite): boolean {
        if (typeof this.handlers[modname] != 'undefined') {
            site = site || this.sitesProvider.getCurrentSite();

            return this.isFeatureDisabled(this.handlers[modname], site);
        }

        return false;
    }
}
