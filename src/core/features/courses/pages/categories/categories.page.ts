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

import { Component, OnInit } from '@angular/core';
import { IonRefresher, NavController } from '@ionic/angular';
import { CoreSites } from '@services/sites';
import { CoreDomUtils } from '@services/utils/dom';
import { CoreUtils } from '@services/utils/utils';
import { CoreCategoryData, CoreCourses, CoreCourseSearchedData } from '../../services/courses';
import { Translate } from '@singletons/core.singletons';
import { ActivatedRoute } from '@angular/router';

/**
 * Page that displays a list of categories and the courses in the current category if any.
 */
@Component({
    selector: 'page-core-courses-categories',
    templateUrl: 'categories.html',
})
export class CoreCoursesCategoriesPage implements OnInit {

    title: string;
    currentCategory?: CoreCategoryData;
    categories: CoreCategoryData[] = [];
    courses: CoreCourseSearchedData[] = [];
    categoriesLoaded = false;

    protected categoryId = 0;

    constructor(
        protected navCtrl: NavController,
        protected route: ActivatedRoute,
    ) {
        this.title = Translate.instance.instant('core.courses.categories');
    }

    /**
     * View loaded.
     */
    ngOnInit(): void {
        this.categoryId = parseInt(this.route.snapshot.params['id'], 0) || 0;

        this.fetchCategories().finally(() => {
            this.categoriesLoaded = true;
        });
    }

    /**
     * Fetch the categories.
     *
     * @return Promise resolved when done.
     */
    protected async fetchCategories(): Promise<void> {
        try{
            const categories: CoreCategoryData[] = await CoreCourses.instance.getCategories(this.categoryId, true);

            this.currentCategory = undefined;

            const index = categories.findIndex((category) => category.id == this.categoryId);

            if (index >= 0) {
                this.currentCategory = categories[index];
                // Delete current Category to avoid problems with the formatTree.
                delete categories[index];
            }

            // Sort by depth and sortorder to avoid problems formatting Tree.
            categories.sort((a, b) => {
                if (a.depth == b.depth) {
                    return (a.sortorder > b.sortorder) ? 1 : ((b.sortorder > a.sortorder) ? -1 : 0);
                }

                return a.depth > b.depth ? 1 : -1;
            });

            this.categories = CoreUtils.instance.formatTree(categories, 'parent', 'id', this.categoryId);

            if (this.currentCategory) {
                this.title = this.currentCategory.name;

                try {
                    this.courses = await CoreCourses.instance.getCoursesByField('category', this.categoryId);
                } catch (error) {
                    CoreDomUtils.instance.showErrorModalDefault(error, 'core.courses.errorloadcourses', true);
                }
            }
        } catch (error) {
            CoreDomUtils.instance.showErrorModalDefault(error, 'core.courses.errorloadcategories', true);
        }
    }

    /**
     * Refresh the categories.
     *
     * @param refresher Refresher.
     */
    refreshCategories(refresher?: CustomEvent<IonRefresher>): void {
        const promises: Promise<void>[] = [];

        promises.push(CoreCourses.instance.invalidateUserCourses());
        promises.push(CoreCourses.instance.invalidateCategories(this.categoryId, true));
        promises.push(CoreCourses.instance.invalidateCoursesByField('category', this.categoryId));
        promises.push(CoreSites.instance.getCurrentSite()!.invalidateConfig());

        Promise.all(promises).finally(() => {
            this.fetchCategories().finally(() => {
                refresher?.detail.complete();
            });
        });
    }

}
