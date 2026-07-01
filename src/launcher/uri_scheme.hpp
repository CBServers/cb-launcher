#pragma once

namespace uri_scheme
{
    // Registers the cbservers:// URL protocol under HKCU for the current exe.
    // Self-healing: rewrites the keys only on first run or when the exe path changed.
    void ensure_registered();
}
