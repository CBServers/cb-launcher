function mockCommand(command, data) {
    console.log("Mock executeCommand:", command, data || null);

    switch (command) {
        case 'get-channel':
            return 'main';
        case 'get-property':
            return null;
        case 'get-game-property':
            return data && data.suffix === PROPERTY_KEYS.GAME.IS_INSTALLED ? 'false' : '';
        case 'is-game-running':
            return false;
        case 'get-cdn-servers':
            return {
                preference: 'auto',
                recommended: 'eu',
                servers: [
                    { region: 'na', latency: 124 },
                    { region: 'eu', latency: 18 }
                ]
            };
        case 'test-cdn-latency':
            return {
                success: true,
                preference: 'auto',
                recommended: 'eu',
                servers: [
                    { region: 'na', latency: 124 },
                    { region: 'eu', latency: 18 }
                ]
            };
        case 'get-version':
            return {
                version: 'UI preview',
                versionFile: 'UI preview',
                gitHash: '00000000',
                gitBranch: 'preview'
            };
        case 'get-update-progress':
            return { active: false, progress: 100, message: 'Complete' };
        default:
            return null;
    }
}

function isStaticPreviewError(error) {
    return window.location.protocol === 'file:' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === 'localhost' ||
        error.name === 'SyntaxError';
}

window.executeCommand = function(command, data) {
    if (window.location.protocol === 'file:' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === 'localhost') {
        return Promise.resolve(mockCommand(command, data));
    }

    var object = {
        command: command,
        data: data || null,
    };

    return fetch("/command", {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(object)
    }).then(response => {
        if (!response.ok) {
            throw new Error(`Command endpoint returned ${response.status}`);
        }
        return response.json();
    }).catch(error => {
        if (isStaticPreviewError(error)) {
            return mockCommand(command, data);
        }
        throw error;
    });
};
