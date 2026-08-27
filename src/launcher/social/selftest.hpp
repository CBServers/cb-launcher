#pragma once

namespace social
{
    // Headless identity check (-social-selftest). Writes a report and returns 0 if everything passed.
    int run_selftest();

    // Dumps the public key and a signed challenge (-social-dump) for cross-verifying the worker.
    int run_dump();
}
