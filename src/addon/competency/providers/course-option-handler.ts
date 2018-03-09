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

import { Injectable } from '@angular/core';
import { NavController } from 'ionic-angular';
import { CoreCourseOptionsHandler, CoreCourseOptionsHandlerData } from '../../../core/course/providers/options-delegate';
import { CoreCourseProvider } from '../../../core/course/providers/course';
import { AddonCompetencyCourseComponent } from '../components/course/course';
import { AddonCompetencyProvider } from '../providers/competency';

/**
 * Course nav handler.
 */
@Injectable()
export class AddonCompetencyCourseOptionHandler implements CoreCourseOptionsHandler {
    name = 'AddonCompetency';
    priority = 700;

    protected coursesNavEnabledCache = {};

    constructor(private competencyProvider: AddonCompetencyProvider) {}

    /**
     * Clear courses nav cache.
     */
    clearCoursesNavCache(): void {
        this.coursesNavEnabledCache = {};
    }

    /**
     * Whether or not the handler is enabled ona site level.
     * @return {boolean|Promise<boolean>} Whether or not the handler is enabled on a site level.
     */
    isEnabled(): boolean | Promise<boolean> {
        return this.competencyProvider.isPluginEnabled();
    }

    /**
     * Whether or not the handler is enabled for a certain course.
     *
     * @param {number} courseId The course ID.
     * @param {any} accessData Access type and data. Default, guest, ...
     * @param {any} [navOptions] Course navigation options for current user. See CoreCoursesProvider.getUserNavigationOptions.
     * @param {any} [admOptions] Course admin options for current user. See CoreCoursesProvider.getUserAdministrationOptions.
     * @return {boolean|Promise<boolean>} True or promise resolved with true if enabled.
     */
    isEnabledForCourse(courseId: number, accessData: any, navOptions?: any, admOptions?: any): boolean | Promise<boolean> {
        if (accessData && accessData.type == CoreCourseProvider.ACCESS_GUEST) {
            return false; // Not enabled for guests.
        }

        if (navOptions && typeof navOptions.competencies != 'undefined') {
            return navOptions.competencies;
        }

        if (typeof this.coursesNavEnabledCache[courseId] != 'undefined') {
            return this.coursesNavEnabledCache[courseId];
        }

        return this.competencyProvider.isPluginForCourseEnabled(courseId).then((competencies) => {
            const enabled = competencies ? !competencies.canmanagecoursecompetencies : false;
            this.coursesNavEnabledCache[courseId] = enabled;

            return enabled;
        });
    }

    /**
     * Returns the data needed to render the handler.
     *
     * @param {number} courseId The course ID.
     * @return {CoreCourseOptionsHandlerData} Data.
     */
    getDisplayData(courseId: number): CoreCourseOptionsHandlerData {
        return {
            title: 'addon.competency.competencies',
            class: 'addon-competency-course-handler',
            component: AddonCompetencyCourseComponent
        };
    }

    /**
     * Should invalidate the data to determine if the handler is enabled for a certain course.
     *
     * @param {number} courseId The course ID.
     * @param {any} [navOptions] Course navigation options for current user. See CoreCoursesProvider.getUserNavigationOptions.
     * @param {any} [admOptions] Course admin options for current user. See CoreCoursesProvider.getUserAdministrationOptions.
     * @return {Promise<any>} Promise resolved when done.
     */
    invalidateEnabledForCourse(courseId: number, navOptions?: any, admOptions?: any): Promise<any> {
        if (navOptions && typeof navOptions.competencies != 'undefined') {
            // No need to invalidate anything.
            return Promise.resolve();
        }

        return this.competencyProvider.invalidateCourseCompetencies(courseId);
    }
}
