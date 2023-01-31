//#region Imports

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

//#endregion

//#region Constants

/**
 * Where to pull the mirrored data from.
 */
const apiEndpoint = 'https://apps.snh.gov.uk/sitelink-api/v1/sites?pagesize=0';

/**
 * Where to save the mirrored files to.
 */
const baseRoot = 'mirror';

/**
 * Where to re-host the mirrored files from.
 */
const baseUrl = 'sitelink-api/v1/sites';

//#endregion

//#region Get Index Helper Functions

const getSitesIndex = async (url) => {
    // Download the url and parse the body as json.
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await response.json();

    // Return it to the caller.
    return data;
}

export const validateSitesIndex = (sitesIndex) => {
    // If we've got nothing, it's invalid.
    if (sitesIndex === undefined) { return false; }

    // If we've not got a sensible `first` value, it's invalid.
    if (sitesIndex.first === undefined || sitesIndex.first !== 1) { return false; }
    
    // If we've not got a sensible `pageSize` value, it's invalid.
    if (sitesIndex.pageSize === undefined || sitesIndex.pageSize !== 0) { return false; }
    
    // If we've not got a sensible `total` value, it's invalid.
    if (sitesIndex.total === undefined || sitesIndex.total < 1) { return false; }

    // If we've not got a sensible `sites` array, it's invalid.
    if (sitesIndex.sites === undefined || sitesIndex.sites.length !== sitesIndex.total) { return false; }

    // If we're here, it must be valid.
    return true;
}

const saveSitesIndex = async (sitesIndex) => {
    // Pretty-print the json to make it easier for git to check diffs. 
    const stringified = JSON.stringify(sitesIndex, undefined, '\t');    

    // Save it as an 'index' file.
    const filePath = resolve(baseRoot, baseUrl, 'index.json');
    await writeFile(filePath, stringified, { encoding: 'utf8' });
}

//#endregion

//#region Get Sites Helper Functions

const validateIndexSite = (indexSite) => {
    if (indexSite === undefined) { return false; }
    if (indexSite.id === undefined) { return false; }
    if (indexSite.url === undefined || !indexSite.url.endsWith(`/${indexSite.id}`)) { return false; }

    return true;
}

const getSite = async (url) => {
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await response.json();
    return data;
}

const validateSite = (site) => {
    if (site === undefined) { return false; }

    return true;
}

const saveSite = async (site) => {
    const sitePath = resolve(baseRoot, baseUrl, `${site.id}`)
    await mkdir(sitePath, { recursive: true });

    const stringified = JSON.stringify(site, undefined, '\t');

    const filePath = resolve(baseRoot, baseUrl, `${site.id}`, 'index.json')
    await writeFile(filePath, stringified, {encoding: 'utf8'});
}

//#endregion

//#region Main Script

// Create the base directory for saving and serving the mirrored data.
const basePath = resolve(baseRoot, baseUrl);
await mkdir(basePath, { recursive: true });

// Grab the sites index
const sitesIndex = await getSitesIndex(apiEndpoint);

// Make sure we've downloaded it correctly.
if (!validateSitesIndex(sitesIndex)) {
    throw new Error('Could not validate sites index!');
}

//  Fix the URLs in the index, making them relative to the mirror root.
const { sites, ...restOfIndex } = sitesIndex;
const fixedIndex = {
    ...restOfIndex, sites: sites.map(indexSite => {
        const { url, id, ...restOfIndexSite } = indexSite;

        const newUrl = `/${baseUrl}/${id}`;

        return { url: newUrl, id, ...restOfIndexSite };
    })
};

// Save the index with the fixed URLs.
await saveSitesIndex(fixedIndex);

//
for (const indexSite of sitesIndex.sites) {
    //
    if (!validateIndexSite(indexSite)) {
        throw new Error('Could not validate site within index!');
    }

    //
    const site = await getSite(indexSite.url);

    //
    if (!validateSite(site)) {
        throw new Error('Could not validate site!');
    }

    const { url, id, ...restOfSite } = site;
    const newUrl = `/${baseUrl}/${id}`;
    const fixedSite = { url: newUrl, id, ...restOfSite };
 
    await saveSite(fixedSite);
}
//#endregion
