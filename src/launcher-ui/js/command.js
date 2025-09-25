window.executeCommand = function(command, data) {

    var object = {
        command: command,
        data: data || null,
    }

    return fetch("/command", {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(object)
    }).then(data => data.json());
};