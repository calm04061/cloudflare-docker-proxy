addEventListener("fetch", (event) => {
    event.passThroughOnException();
    event.respondWith(handleRequest(event.request));
});

const routes = {
    "docker.calm0406.tk": "https://registry-1.docker.io",
    "quay.calm0406.tk": "https://quay.io",
    "gcr.calm0406.tk": "https://gcr.io",
    "k8s-gcr.calm0406.tk": "https://k8s.gcr.io",
    "k8s.calm0406.tk": "https://registry.k8s.io",
    "ghcr.calm0406.tk": "https://ghcr.io",
    "cloudsmith.calm0406.tk": "https://docker.cloudsmith.io",
};

function routeByHosts(host) {
    if (host in routes) {
        return routes[host];
    }
    if (MODE === "debug") {
        return TARGET_UPSTREAM;
    }
    return "";
}

async function handleRequest(request) {
    const url = new URL(request.url);
    const upstream = routeByHosts(url.hostname);
    if (upstream === "") {
        return new Response(JSON.stringify({
            routes: routes,
        }), {
            status: 404,
        });
    }
    // check if need to authenticate
    if (url.pathname === "/v2/") {
        const newUrl = new URL(upstream + "/v2/");
        const authorization = request.headers.get("Authorization");
        const copyHeaders = new Headers();
        if (authorization !== null) {
            copyHeaders.set("Authorization", authorization);
        }
        const resp = await fetch(newUrl.toString(), {
            method: "GET", redirect: "follow", headers: copyHeaders,
        });
        if (resp.status === 200) {
        } else if (resp.status === 401) {
            const headers = new Headers();
            if (MODE === "debug") {
                headers.set("Www-Authenticate", `Bearer realm="${LOCAL_ADDRESS}/v2/auth",service="cloudflare-docker-proxy"`);
            } else {
                headers.set("Www-Authenticate", `Bearer realm="https://${url.hostname}/v2/auth",service="cloudflare-docker-proxy"`);
            }
            return new Response(JSON.stringify({message: "UNAUTHORIZED"}), {
                status: 401, headers: headers,
            });
        } else {
            return resp;
        }
    } else
        // get token
    if (url.pathname === "/v2/auth") {
        const newUrl = new URL(upstream + "/v2/");
        const resp = await fetch(newUrl.toString(), {
            method: "GET", redirect: "follow",
        });
        if (resp.status !== 401) {
            return resp;
        }
        const authenticateStr = resp.headers.get("WWW-Authenticate");
        if (authenticateStr === null) {
            return resp;
        }
        const wwwAuthenticate = parseAuthenticate(authenticateStr);
        return await fetchToken(wwwAuthenticate, url.searchParams, request);
    }else{
        // foward requests
        const newUrl = new URL(upstream + url.pathname);
        const newReq = new Request(newUrl, request);
        return await fetch(newReq);
    }
}

function parseAuthenticate(authenticateStr) {
    // sample: Bearer realm="https://auth.ipv6.docker.com/token",service="registry.docker.io"
    // match strings after =" and before "
    const re = /(?<=\=")(?:\\.|[^"\\])*(?=")/g;
    const matches = authenticateStr.match(re);
    if (matches === null || matches.length < 2) {
        throw new Error(`invalid Www-Authenticate Header: ${authenticateStr}`);
    }
    return {
        realm: matches[0], service: matches[1],
    };
}

async function fetchToken(wwwAuthenticate, searchParams, request) {
    const url = new URL(wwwAuthenticate.realm);
    if (wwwAuthenticate.service.length) {
        url.searchParams.set("service", wwwAuthenticate.service);
    }
    if (searchParams.get("scope")) {
        url.searchParams.set("scope", searchParams.get("scope"));
    }
    return await fetch(url, request);
}
