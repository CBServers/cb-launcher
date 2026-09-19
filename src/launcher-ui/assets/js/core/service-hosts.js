// Backend hosts from the launcher; a request with no HTTP response moves that service to its next host.

(function () {
    let hosts = {};
    let loading = null;
    const active = {};

    function load() {
        if (!loading) {
            loading = window.executeCommand('get-service-hosts')
                .then(result => { hosts = result || {}; })
                .catch(error => {
                    loading = null;
                    throw error;
                });
        }
        return loading;
    }

    async function request(service, path, init) {
        await load();
        const list = Array.isArray(hosts[service]) ? hosts[service] : [];
        if (!list.length) throw new Error(`No hosts for ${service}`);

        let lastError = null;
        for (let attempt = 0; attempt < list.length; attempt++) {
            const index = (active[service] || 0) % list.length;
            try {
                return await fetch(list[index] + path, init);
            } catch (error) {
                // fetch only rejects when no HTTP response came back, the one failure another domain can fix.
                lastError = error;
                if (list.length > 1 && ((active[service] || 0) % list.length) === index) {
                    active[service] = (index + 1) % list.length;
                    console.warn(`ServiceHosts: ${service} unreachable at ${list[index]}, switching to ${list[active[service]]}`);
                }
            }
        }
        throw lastError;
    }

    window.ServiceHosts = { request };
})();
