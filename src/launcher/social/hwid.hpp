#pragma once

#include <string>

namespace social::hwid
{
    // sha256 of the machine GUID + system volume serial. A recovery anchor, not a secret.
    std::string compute();
}
