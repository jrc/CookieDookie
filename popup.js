const allowedSitesTextarea = document.getElementById('allowedSitesTextarea');
const addSiteButton = document.getElementById('addSiteButton');
const cookiesInfo = document.getElementById('cookiesInfo');
const deleteNonAllowedDataButton = document.getElementById('deleteNonAllowedDataButton');

const LOCAL_STORAGE_ALLOWEDDOMAINS_KEY = "us.jrcpl.CookieDookie.allowedDomains";


// Pure utility function
// e.g. "www.apple.com" -> "apple.com", "careers.bbc.co.uk" -> "bbc.co.uk"
function extractMeaningfulDomain(domain) {
  // Remove any leading dot, e.g. ".bbc.co.uk"
  domain = domain.replace(/^\./, '');

  const parts = domain.split('.');

  if (parts.length > 2 && parts.at(-1).length === 2 && parts.at(-2).length <= 3) {
      // Likely a ccTLD + generic SLD (e.g., .co.uk, .com.au)
      // See also https://publicsuffix.org/
      return domain.replace(/^(www|blog|app|news|careers)\./, '');
  }

  // Default: Keep only the last two components (SLD + TLD)
  return parts.slice(-2).join('.');
}

// Parsing the Allowed Sites textarea and return array of user-allowed domains 
function getAllowedDomainsFromUI() {
  return allowedSitesTextarea.value
    .split("\n")
    .filter(x => x.trim() !== "") // Remove empty lines
    .sort();
}

// Read from Local Storage API and update the Allowed Sites textarea
async function load() {
  try {
    const result = await chrome.storage.local.get(LOCAL_STORAGE_ALLOWEDDOMAINS_KEY);

    let allowDomains = result[LOCAL_STORAGE_ALLOWEDDOMAINS_KEY] || [];
    allowedSitesTextarea.value = allowDomains.join("\n");
    }
  catch (error) {
    console.error(error.message);
  }
}

// Write to Local Storage API, using domains from Allowed Sites textarea
async function save() {  
  try {
    let allowedDomains = getAllowedDomainsFromUI();

    // Use computed property name to use value of the variable as the key :P
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Object_initializer#computed_property_names
    await chrome.storage.local.set({ [LOCAL_STORAGE_ALLOWEDDOMAINS_KEY]: allowedDomains });
  }
  catch (error) {
    console.error(error.message);
  }
}


// Return cookies with user-allowed filtered out
function filterForNonAllowedCookies(cookies) {
  let allowedDomains = getAllowedDomainsFromUI();

  const nonAllowedCookies = cookies.filter(cookie => {
    return !allowedDomains.some(allowedDomain => {
      const regex = new RegExp(`\.?${allowedDomain}$`);
      return regex.test(cookie.domain);
    });
  });
  return nonAllowedCookies;
}

// Read from Cookies API and update UI elements based on current state
async function update() {
  // Update Allowed Sites section
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    try {
      let url = new URL(tab.url);

      let domain = extractMeaningfulDomain(url.hostname);
      let allowedDomains = getAllowedDomainsFromUI();
    
      addSiteButton.textContent = `➕ Add ${domain}`;
      addSiteButton.disabled = allowedDomains.includes(domain);

      addSiteButton.addEventListener("click", async (event) => {  
        allowedDomains.push(domain);
        allowedDomains = [...new Set(allowedDomains)].sort();
        allowedSitesTextarea.value = allowedDomains.join("\n");

        // Perform after delay to allow UI values to be set
        setTimeout(async () => {
          await save();
          await update();
        }, 0);
      });
    } catch {
      // ignore
    }
  }

  // Update Delete Browsing Data section
  const cookies = await chrome.cookies.getAll({});
  const nonAllowedCookies = filterForNonAllowedCookies(cookies);
  const nonAllowedCookieSLDs = [...new Set(nonAllowedCookies.map(cookie => extractMeaningfulDomain(cookie.domain)))];

  if (nonAllowedCookieSLDs.length === 1) {
    deleteNonAllowedDataButton.textContent = `🔥 Delete Data From ${nonAllowedCookieSLDs.length} Site`;
  }
  else {
    deleteNonAllowedDataButton.textContent = `🔥 Delete Data From ${nonAllowedCookieSLDs.length} Sites`;    
  }

  if (nonAllowedCookies.length == 0) {
    cookiesInfo.innerHTML = "";
    deleteNonAllowedDataButton.disabled = true;
  }
  else {
    cookiesInfo.innerHTML = nonAllowedCookieSLDs.slice(0, 7).map(str => "• " + str).join("<br>");
    if (nonAllowedCookieSLDs.length > 7) {
      cookiesInfo.innerHTML += "<br>• …and more";
    }
    deleteNonAllowedDataButton.disabled = false;
  }
}


// The async IIFE is necessary because Chrome <89 does not support top level await.
(async function initPopupWindow() {
  addSiteButton.disabled = true;
  allowedSitesTextarea.placeholder = allowedSitesTextarea.placeholder.replace(/\\n/g, '\n');

  await load();
  await update();
})();


allowedSitesTextarea.addEventListener("input", async (event) => {
  await save();
  await update();
});

deleteNonAllowedDataButton.addEventListener("click", async (event) => {  
  try {
    let allowedDomains = getAllowedDomainsFromUI();
    clearBrowsingDataExcept(allowedDomains);
  } catch (error) {
    console.error(error.message);
  } finally {
    // FIXME: Wait for cookies to be deleted before update (shouldn't need this)
    setTimeout(async () => {
      await update();
    }, 100);
  }
});


async function clearBrowsingDataExcept(allowedDomains) {
  try {
    const removalOptions = {
      "since": 0, // Clear data from all time
      "excludeOrigins": allowedDomains.flatMap(domain => [
        new URL(`http://${domain}`).origin,
        new URL(`https://${domain}`).origin
      ]),
    };

    const dataToRemove = {
      "appcache": true,
      "cache": true,
      "cacheStorage": true,
      "cookies": true,
      // "downloads": false,
      "fileSystems": true,
      // "formData": false,
      // "history": false,
      "indexedDB": true,
      "localStorage": true,
      // "passwords": false,
      "serviceWorkers": true,
      "webSQL": true
    };

    await new Promise((resolve, reject) => {
      chrome.browsingData.remove(removalOptions, dataToRemove, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });

    // The "excludeOrigins" option of chrome.browsingData.remove() excludes
    // cookies from "the whole registrable domain"
    // https://developer.chrome.com/docs/extensions/reference/api/browsingData
    // which means that if the user has e.g. foo.example.com
    // in their allow list, unwanted cookies from example.com may be left.
    // This handles that case.
    const cookies = await chrome.cookies.getAll({});
    const nonAllowedCookies = filterForNonAllowedCookies(cookies);
    if (nonAllowedCookies.length > 0) {
      for (const cookie of nonAllowedCookies) {
        await deleteCookie(cookie); // Await each deletion individually
      }
    }
  } catch (error) {
    console.error(error.message);
  }
}

// from https://github.com/GoogleChrome/chrome-extensions-samples/blob/main/api-samples/cookies/cookie-clearer/popup.js
function deleteCookie(cookie) {
  // Cookie deletion is largely modeled off of how deleting cookies works when using HTTP headers.
  // Specific flags on the cookie object like `secure` or `hostOnly` are not exposed for deletion
  // purposes. Instead, cookies are deleted by URL, name, and storeId. Unlike HTTP headers, though,
  // we don't have to delete cookies by setting Max-Age=0; we have a method for that ;)
  //
  // To remove cookies set with a Secure attribute, we must provide the correct protocol in the
  // details object's `url` property.
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#Secure
  const protocol = cookie.secure ? 'https:' : 'http:';

  // Note that the final URL may not be valid. The domain value for a standard cookie is prefixed
  // with a period (invalid) while cookies that are set to `cookie.hostOnly == true` do not have
  // this prefix (valid).
  // https://developer.chrome.com/docs/extensions/reference/cookies/#type-Cookie
  const cookieUrl = `${protocol}//${cookie.domain}${cookie.path}`;

  return chrome.cookies.remove({
    url: cookieUrl,
    name: cookie.name,
    storeId: cookie.storeId
  });
}
