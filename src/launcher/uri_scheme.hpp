#pragma once

namespace uri_scheme
{
    // Registers/repairs the cbservers:// URL protocol under HKCU for the current exe.
    void ensure_registered();
}
