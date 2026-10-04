// Server tags for the launcher's server list. A tagged server shows its label, note and Discord
// button wherever it appears; featured: true also pins it in the Featured box at the top.
//
// Keyed by launcher game key (cod4x, t6, boiii, ...). Each entry:
//   id        'ip:port' exactly as the server list reports it (not a hostname)
//   label     optional, 'official' (run by CB Servers) | 'contributor' (run by a launcher contributor) | 'event';
//             any other value drops the whole entry
//   note      optional, one line shown under the name, cut at 80 characters
//   discord   optional https://discord.gg/... or https://discord.com/... invite; anything else is dropped
//   featured  optional, true to pin it in the Featured box
//   until     optional ISO date after which the entry is ignored
//
// Featured servers are ordered official first, then contributor, then event, then unlabelled, in the
// order written here. At most five per game are featured, counted among servers in the live list, so
// an offline one frees its slot.
//
// Example:
//   t6: [
//       { id: '1.2.3.4:4976', label: 'official', note: '24/7 Nuketown', discord: 'https://discord.gg/abc123', featured: true },
//       { id: '5.6.7.8:4976', label: 'contributor', note: 'Hosted by X' },
//   ],
const CB = { label: 'official', note: 'CB Servers', discord: 'https://discord.com/invite/WyJQCwCCGW' };
const ERODED = { label: 'contributor', note: 'Eroded Networks', discord: 'https://discord.com/invite/HWgB6G3KFd' };

export default {
    t4: [
        { id: '103.152.197.155:4777', ...ERODED, featured: true },   // WAW Plutonium Official
        { id: '103.152.197.155:4778', ...ERODED, featured: true },   // WAW Plutonium Modded
        { id: '103.152.197.155:4779', ...ERODED },                   // WaW First Room
        { id: '159.195.205.193:27019', ...ERODED },                  // [EU] WAW Plutonium Official
        { id: '159.195.205.193:27020', ...ERODED },                  // [EU] WAW Plutonium Modded
    ],
    t5: [
        { id: '103.152.197.155:4878', ...ERODED, featured: true },   // BO1 Plutonium Official
        { id: '103.152.197.155:4877', ...ERODED, featured: true },   // BO1 Plutonium Modded
        { id: '103.152.197.155:4879', ...ERODED },                   // BO1 Plutonium Official #2
        { id: '103.152.197.155:4880', ...ERODED },                   // BO1 First Room
        { id: '159.195.205.193:27017', ...ERODED },                  // [EU] BO1 Plutonium Official
        { id: '159.195.205.193:27018', ...ERODED },                  // [EU] BO1 Plutonium Modded
    ],
    t6: [
        { id: '142.248.82.8:4976', ...CB, featured: true },          // Stank's Custom Gun Game
        { id: '103.152.197.155:4976', ...ERODED, featured: true },   // BO2 Plutonium Modded
        { id: '103.152.197.155:4977', ...ERODED, featured: true },   // BO2 Plutonium Official
        { id: '103.152.197.155:4981', ...ERODED, featured: true },   // BO2 Zombies Declassified
        { id: '103.152.197.155:4978', ...ERODED },                   // BO2 Plutonium Official #2
        { id: '103.152.197.155:4980', ...ERODED },                   // BO2 FFA Bot Fill
        { id: '103.152.197.155:4982', ...ERODED },                   // BO2 First Room
        { id: '159.195.205.193:27015', ...ERODED },                  // [EU] BO2 Plutonium Official
        { id: '159.195.205.193:27016', ...ERODED },                  // [EU] BO2 Plutonium Modded
    ],
    boiii: [
        { id: '142.248.82.8:30120', ...CB, featured: true },         // Stank's Custom Gun Game
        { id: '142.248.82.8:27019', ...CB, featured: true },         // Celebrity's FFA Trickshot
        { id: '142.248.82.8:27021', ...CB, featured: true },         // Celebrity's SND Trickshot
        { id: '103.152.197.155:27017', ...ERODED, featured: true },  // ERODED BO3 #1
        { id: '103.152.197.155:29018', ...ERODED },                  // ERODED BO3 #2
        { id: '103.152.197.155:29017', ...ERODED, featured: true },  // ERODED BO3 Modded Zombies
        { id: '103.152.197.155:29019', ...ERODED },                  // BO3 First Room
        { id: '103.152.197.155:29020', ...ERODED },                  // ERODED BO3 CB Ubuntu Test
    ],
    iw6x: [
        { id: '142.248.82.8:27017', ...CB, featured: true },         // Celebrity's FFA Trickshot
        { id: '103.152.197.155:4979', ...ERODED, featured: true },   // ERODED Extinction
    ],
    'iw7-mod': [
        { id: '142.248.82.8:27020', ...CB, featured: true },         // Celebrity's FFA Trickshot
    ],
    s1x: [
        { id: '142.248.82.8:27016', ...CB, featured: true },         // Celebrity's FFA Trickshot
    ],
    'h1-mod': [
        { id: '142.248.82.8:27018', ...CB, featured: true },         // Celebrity's FFA Trickshot
    ],
};
