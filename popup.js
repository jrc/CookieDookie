const allowedSitesTextarea = document.getElementById('allowedSitesTextarea');
const addSiteButton = document.getElementById('addSiteButton');
const cookiesHeader = document.getElementById('cookiesHeader');
const cookiesInfo = document.getElementById('cookiesInfo');
const deleteNonAllowedCookiesButton = document.getElementById('deleteNonAllowedCookiesButton');

const LOCAL_STORAGE_ALLOWEDDOMAINS_KEY = "us.jrcpl.CookieDookie.allowedDomains";


// Pure utility function, e.g. "www.apple.com" -> "apple.com"
function getSecondLevelDomain(hostname) {
  var domain = hostname;
  const parts = domain.split('.');
  if (parts.length >= 2) {
    domain = parts.slice(-2).join('.');
  }
  return domain;
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
    console.error(error);
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
    console.error(error);
  }
}


// Return cookies with user-allowed filtered out
function filterForNonAllowedCookies(cookies) {
  let allowedDomains = getAllowedDomainsFromUI();

  const nonAllowedCookies = cookies.filter(cookie => {
    return !allowedDomains.some(domain => {
      const regex = new RegExp(`${domain}$`);
      return regex.test(cookie.domain);
    });
  });
  return nonAllowedCookies;
}

// Read from Cookies API and update UI elements based on current state
async function update() {
  const cookies = await chrome.cookies.getAll({});
  const nonAllowedCookies = filterForNonAllowedCookies(cookies);

  cookiesHeader.textContent = `Cookies (${cookies.length})`;
  deleteNonAllowedCookiesButton.textContent = `Delete ${nonAllowedCookies.length} Unwanted Cookies`;

  if (nonAllowedCookies.length == 0) {
    cookiesInfo.innerHTML = "";
    deleteNonAllowedCookiesButton.disabled = true;
  }
  else {
    const nonAllowedCookieSLDs = [...new Set(nonAllowedCookies.map(cookie => getSecondLevelDomain(cookie.domain)))];
    cookiesInfo.innerHTML = nonAllowedCookieSLDs.slice(0, 5).map(str => "• " + str).join("<br>");
    if (nonAllowedCookies.length > 5) {
      cookiesInfo.innerHTML += "<br>• …and more";
    }
    deleteNonAllowedCookiesButton.disabled = false;
  }
}


// The async IIFE is necessary because Chrome <89 does not support top level await.
(async function initPopupWindow() {
  addSiteButton.disabled = true;

  allowedSitesTextarea.placeholder = allowedSitesTextarea.placeholder.replace(/\\n/g, '\n');

  try {
    await load();
  }
  catch (error) {
  }

  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab?.url) {
    try {
      let url = new URL(tab.url);

      let domain = getSecondLevelDomain(url.hostname);
    
      addSiteButton.textContent = `Add This Site (${domain})`;

      let allowedDomains = getAllowedDomainsFromUI();
  
      addSiteButton.addEventListener("click", async (event) => {  
        allowedDomains.push(domain);
        allowedDomains = [...new Set(allowedDomains)].sort();
        allowedSitesTextarea.textContent = allowedDomains.join("\n");

        await save();
      });

      if (!allowedDomains.includes(domain)) {
        addSiteButton.disabled = false;
      }
    } catch {
      // ignore
    }
  }

  await update();
})();


allowedSitesTextarea.addEventListener("input", async (event) => {
  await save();
  await update();
});

deleteNonAllowedCookiesButton.addEventListener("click", async (event) => {  
  try {
    const cookies = await chrome.cookies.getAll({});
    const nonAllowedCookies = filterForNonAllowedCookies(cookies);

    let pending = nonAllowedCookies.map(deleteCookie);
    await Promise.all(pending);
  } catch (error) {
    console.error(error.message);
  } finally {
    await update();
  }
});


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
