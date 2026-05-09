(function () {
    const MAX_TOASTS = 5;
    const VALID_TYPES = new Set(["info", "success", "error"]);

    function getContainer() {
        let container = document.querySelector("#toast-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "toast-container";
            document.body.appendChild(container);
        }
        return container;
    }

    function dismissToast(toast) {
        if (!toast || toast.dataset.dismissed === "1") return;
        toast.dataset.dismissed = "1";
        toast.classList.remove("visible");

        const remove = () => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        };
        let removed = false;
        const onEnd = (e) => {
            if (e.propertyName !== "opacity") return;
            removed = true;
            toast.removeEventListener("transitionend", onEnd);
            remove();
        };
        toast.addEventListener("transitionend", onEnd);
        // Fallback in case transitionend doesn't fire
        setTimeout(() => { if (!removed) { toast.removeEventListener("transitionend", onEnd); remove(); } }, 400);
    }

    window.showToast = function (message, type, duration) {
        if (typeof message !== "string") message = String(message == null ? "" : message);
        type = VALID_TYPES.has(type) ? type : "info";
        duration = (typeof duration === "number" && duration > 0) ? duration : 6000;

        const container = getContainer();

        // Cap stack: drop oldest immediately when over the limit
        while (container.children.length >= MAX_TOASTS) {
            const oldest = container.firstElementChild;
            if (!oldest) break;
            if (oldest.parentNode) oldest.parentNode.removeChild(oldest);
        }

        const toast = document.createElement("div");
        toast.className = "toast toast-" + type;
        toast.setAttribute("role", type === "error" ? "alert" : "status");
        toast.textContent = message;
        container.appendChild(toast);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => toast.classList.add("visible"));
        });

        const timer = setTimeout(() => dismissToast(toast), duration);

        toast.addEventListener("click", () => {
            clearTimeout(timer);
            dismissToast(toast);
        });

        return toast;
    };
})();
