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
    await writeFile(filePath, stringified, { encoding: 'utf8' });
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

// It's possible for a download from the origin API to fail, so we use a
// queue to allow us to retry any failed downloads at the end.
const siteQueue = [];

// Loop over each of the sites in the index.
for (const indexSite of sitesIndex.sites) {

    // Make sure it's understandable as a 'site'.
    if (!validateIndexSite(indexSite)) {
        throw new Error('Could not validate site within index!');
    }

    // Add it to the end of the queue.
    siteQueue.push(indexSite);
}

// As long as we've a backlog of sites in our queue.
while (siteQueue.length != 0) {

    // Get the first site from the queue.
    const indexSite = siteQueue.shift();

    // The download and save might fail, so we need to `try` to do it.
    try {
        // Let the user know how we're getting on.
        console.log(`Getting #${indexSite.id}.`);

        // Grab the whole site JSON object.
        const site = await getSite(indexSite.url);

        // Make sure that the download parsed correctly.
        if (!validateSite(site)) {
            throw new Error('Could not validate site!');
        }

        // Fix the object so the URL references are relative to our potential
        // new mirror location.
        const { url, id, ...restOfSite } = site;
        const newUrl = `/${baseUrl}/${id}`;
        const fixedSite = { url: newUrl, id, ...restOfSite };

        // Save the updated JSON to disk.
        await saveSite(fixedSite);

        // Let the user know how we did, and what's left to do.
        console.log(`#${indexSite.id} done. ${siteQueue.length} sites to go.\n`);

    // If any of that failed.
    } catch {
        // Let the user know it went 'wobbly'.
        console.log(`#${indexSite.id} failed. Retrying later. ${siteQueue.length} sites to go.\n`);

        // Add the site back on to the end of the queue again for later
        // consumption.
        siteQueue.push(indexSite);
    }
}
//#endregion
