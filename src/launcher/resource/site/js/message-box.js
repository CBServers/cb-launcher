function constructMessageBox(title, message, buttons) {
    title = title || "Error";
    nessage = message || "";
    buttons = buttons || ["Ok"];

    return new Promise((resolve, reject) => {
        try{
            const messageBox = document.querySelector("#message-box");

            const resolveInternal = function() {
                messageBox.classList.remove("visible");
                return resolve.apply(this, arguments);
            };

            const titleElement = messageBox.querySelector(".mb-title");
            titleElement.innerHTML = title;

            const contentElement = messageBox.querySelector(".mb-content");
            contentElement.innerHTML = message;

            const buttonElement = messageBox.querySelector(".mb-buttons");
            buttonElement.textContent = "";

            messageBox.classList.add("visible");

            buttons.forEach((value, index) => {

                var button = document.createElement("button");
                button.innerHTML = value;
                button.onclick = resolveInternal.bind(this, index);
                buttonElement.appendChild(button);
            });
        }
        catch(e) {
            reject(e);
        }
    });
}

window.showMessageBox = function() {
    window.lastBox = window.lastBox || Promise.resolve();

    const newBox = window.lastBox.then(() => constructMessageBox.apply(this, arguments));
    window.lastBox = newBox;

    return newBox;
};
