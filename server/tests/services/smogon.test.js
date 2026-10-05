const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { StatusCode } = require("status-code-enum");
const { ApiError } = require("../../middleware/errors");
const { createSmogonSource, htmlToText, normalizeSmogonUrl, MAX_AGE_MS, RETRY_DELAY_MS, MAX_RESPONSE_LENGTH, getSmogonSource, setSmogonSource } = require("../../services/smogon");
const { createSmogonFixtures, createSmogonFetch } = require("../helpers/smogon-fixtures");
const { PROGRESS_LABELS } = require("../../services/progress");

const DATA_DIRECTORY_ENV = "SPREAD_EDITOR_DATA_DIR";


describe("Smogon source", () =>
{
    let directory;
    let originalDirectory;
    let resources;
    let fetchResource;
    let clock;
    let source;

    beforeEach(() =>
    {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "smogon-test-"));
        originalDirectory = process.env[DATA_DIRECTORY_ENV];
        process.env[DATA_DIRECTORY_ENV] = directory;
        resources = createSmogonFixtures();
        fetchResource = createSmogonFetch(resources);
        clock = 1000;
        source = createSmogonSource({ directory, fetchResource, now: () => clock });
    });

    afterEach(() =>
    {
        setSmogonSource();
        if (originalDirectory === undefined)
            delete process.env[DATA_DIRECTORY_ENV];
        else
            process.env[DATA_DIRECTORY_ENV] = originalDirectory;
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it("preserves raw options and descriptions and supplies missing analysis sets", async () =>
    {
        const result = await source.getSets(["Charizard"]);
        expect(result).to.have.all.keys("formats", "sets", "stale", "unavailable");
        const set = result.sets[0];
        expect(set).to.have.all.keys("format", "species", "name", "description", "moveset");
        expect(set).to.include({ format: "championsou", species: "Charizard", name: "Drought Offense", description: "Use & win.\n\n\u2022 Stay fast." });
        expect(set.moveset).to.deep.equal({ moves: ["Flamethrower", ["Solar Beam", "Air Slash"]], ability: "Blaze", item: ["Charizardite Y"], nature: ["Timid", "Modest"], evs: [{ spa: 32, spe: 32 }], ivs: null });
        const fallback = result.sets.find((entry) => entry.name === "Fallback");
        expect(fallback.description).to.equal(null);
        expect(fallback.moveset.moves).to.deep.equal(["Fire Blast"]);
        expect(fallback.moveset.item).to.equal("Leftovers");
    });

    it("uses fresh disk cache without network across new sources", async () =>
    {
        const expected = await source.getSets(["Charizard"]);
        const calls = fetchResource.calls.length;
        fetchResource.offline = true;
        const next = createSmogonSource({ directory, fetchResource, now: () => clock });
        expect(await next.getSets(["Charizard"])).to.deep.equal(expected);
        expect(fetchResource.calls).to.have.length(calls);
        expect(fs.existsSync(path.join(directory, "sets", "championsou.json"))).to.equal(true);
    });

    it("reports actual completed formats including unavailable files and cached loads", async () =>
    {
        delete resources["/sets/gen9ou.json"];
        const events = [];
        const progress = { update: (event) => events.push({ ...event, downloads: fetchResource.calls.length }) };
        const result = await source.getSets(["Charizard"], { progress });
        expect(result.unavailable).to.deep.equal(["gen9ou"]);
        expect(events.map((event) => event.percentage)).to.deep.equal([0, 0, 33, 66, 99]);
        expect(events.map((event) => event.downloads)).to.deep.equal([0, 1, 3, 5, 7]);
        expect(events[0].label).to.equal(PROGRESS_LABELS.listing);
        expect(events.slice(1).every((event) => event.label === PROGRESS_LABELS.reading)).to.equal(true);
        events.length = 0;
        fetchResource.offline = true;
        await source.getSets(["Charizard"], { progress });
        expect(events.map((event) => event.percentage)).to.deep.equal([0, 0, 33, 66, 99]);
        expect(fetchResource.calls).to.have.length(7);
    });

    it("reports discovery only when the initial index cannot load", async () =>
    {
        fetchResource.offline = true;
        const events = [];
        await source.getSets(["Charizard"], { progress: { update: (event) => events.push(event) } }).catch(() => {});
        expect(events).to.deep.equal([{ percentage: 0, label: PROGRESS_LABELS.listing }]);
    });

    it("refreshes expired files and the library memory cache", async () =>
    {
        await source.getSets(["Charizard"]);
        const calls = fetchResource.calls.length;
        clock += MAX_AGE_MS;
        resources["/sets/championsou.json"].Charizard["Drought Offense"].nature = ["Bold"];
        const result = await source.getSets(["Charizard"]);
        expect(result.sets[0].moveset.nature).to.deep.equal(["Bold"]);
        expect(result.stale).to.equal(false);
        expect(fetchResource.calls.length).to.equal(calls * 2);
    });

    it("uses stale data offline, delays retries, then recovers", async () =>
    {
        await source.getSets(["Charizard"]);
        clock += MAX_AGE_MS;
        fetchResource.offline = true;
        const result = await source.getSets(["Charizard"]);
        expect(result.stale).to.equal(true);
        expect(result.unavailable).to.deep.equal([]);
        const calls = fetchResource.calls.length;
        clock += RETRY_DELAY_MS - 1;
        expect((await source.getSets(["Charizard"])).stale).to.equal(true);
        expect(fetchResource.calls).to.have.length(calls);
        clock++;
        fetchResource.offline = false;
        expect((await source.getSets(["Charizard"])).stale).to.equal(false);
        expect(fetchResource.calls.length).to.be.greaterThan(calls);
    });

    it("returns a 503 ApiError when the index has never been cached", async () =>
    {
        fetchResource.offline = true;
        let error;
        try
        {
            await source.getSets(["Charizard"]);
        }
        catch (caught)
        {
            error = caught;
        }
        expect(error).to.be.instanceOf(ApiError);
        expect(error.status).to.equal(StatusCode.ServerErrorServiceUnavailable);
        expect(error.message).to.equal("Smogon sets need an internet connection the first time.");
        await source.getSets(["Charizard"]).catch(() => {});
        expect(fetchResource.calls).to.have.length(1);
    });

    it("normalizes doubled slashes and rejects forbidden resource URLs", () =>
    {
        expect(normalizeSmogonUrl("https://data.pkmn.cc//sets/index.json").href).to.equal("https://data.pkmn.cc/sets/index.json");
        for (const url of ["https://evil.example/sets/index.json", "http://data.pkmn.cc/sets/index.json", "https://data.pkmn.cc/stats/gen9ou.json", "https://data.pkmn.cc/sets/../index.json", "https://data.pkmn.cc/sets/gen9ou.json?x=1", "https://user@data.pkmn.cc/sets/index.json", "https://data.pkmn.cc:123/sets/index.json"])
            expect(() => normalizeSmogonUrl(url)).to.throw("Invalid Smogon resource URL");
    });

    it("rejects oversized resource responses without caching them", async () =>
    {
        const oversized = createSmogonSource({ directory, fetchResource: async () => new Response("{}", { headers: { "content-length": String(MAX_RESPONSE_LENGTH + 1) } }) });
        await oversized.getSets(["Charizard"]).then(() => { throw new Error("Expected rejection"); }, (error) => expect(error.status).to.equal(StatusCode.ServerErrorServiceUnavailable));
        expect(fs.existsSync(path.join(directory, "sets", "index.json"))).to.equal(false);
    });

    it("enforces the actual streamed size when content-length is missing", async () =>
    {
        const oversized = createSmogonSource({ directory, fetchResource: async () => new Response(new Uint8Array(MAX_RESPONSE_LENGTH + 1)) });
        await oversized.getSets(["Charizard"]).then(() => { throw new Error("Expected rejection"); }, (error) => expect(error.status).to.equal(StatusCode.ServerErrorServiceUnavailable));
        expect(fs.existsSync(path.join(directory, "sets", "index.json"))).to.equal(false);
    });

    it("discovers labels, tab order, singles before doubles and newest VGC first", async () =>
    {
        resources = createSmogonFixtures(
        [
            "gen6battlespotdoubles", "gen9vgc2023", "gen9doublesou", "gen9battlestadiumdoubles",
            "gen7battlespotsingles", "gen8ou", "championsou", "gen9battlestadiumsingles",
            "gen9ou", "gen9vgc2024", "gen5ou", "gen9uu",
        ]);
        const result = await createSmogonSource({ directory, fetchResource: createSmogonFetch(resources) }).getSets(["Charizard"]);
        expect(result.formats.map((format) => format.id)).to.deep.equal(
        [
            "championsou", "gen9ou", "gen9battlestadiumsingles", "gen9uu", "gen9doublesou",
            "gen9battlestadiumdoubles", "gen9vgc2024", "gen9vgc2023", "gen8ou",
            "gen7battlespotsingles", "gen6battlespotdoubles",
        ]);
        expect(result.formats.map((format) => format.label)).to.deep.equal(
        [
            "OU", "OU", "Battle Stadium Singles", "UU", "Doubles OU", "Battle Stadium Doubles",
            "VGC 2024", "VGC 2023", "OU", "Battle Spot Singles", "Battle Spot Doubles",
        ]);
        expect(result.formats[0]).to.deep.equal({ id: "championsou", tab: "champions", category: "singles", label: "OU" });
        expect(result.formats[4].category).to.equal("doubles");
    });

    it("orders and labels every allowed tier and excludes unlisted metagames", async () =>
    {
        const singles =
        [
            ["nationaldex", "National Dex"], ["nationaldexubers", "National Dex Ubers"],
            ["nationaldexuu", "National Dex UU"], ["nationaldexru", "National Dex RU"],
            ["anythinggoes", "AG"], ["ubers", "Ubers"], ["ou", "OU"],
            ["battlestadiumsingles", "Battle Stadium Singles"], ["battlespotsingles", "Battle Spot Singles"],
            ["ubersuu", "Ubers UU"], ["uubl", "UUBL"], ["uu", "UU"], ["rubl", "RUBL"],
            ["ru", "RU"], ["nubl", "NUBL"], ["nu", "NU"], ["publ", "PUBL"], ["pu", "PU"],
            ["zubl", "ZUBL"], ["zu", "ZU"], ["nfe", "NFE"], ["lc", "LC"],
        ];
        const doubles =
        [
            ["nationaldexdoubles", "National Dex Doubles"], ["doublesubers", "Doubles Ubers"],
            ["doublesou", "Doubles OU"], ["battlestadiumdoubles", "Battle Stadium Doubles"],
            ["battlespotdoubles", "Battle Spot Doubles"], ["vgc2026", "VGC 2026"],
            ["vgc2025", "VGC 2025"], ["doublesuu", "Doubles UU"],
            ["doublesnu", "Doubles NU"], ["doubleslc", "Doubles LC"],
        ];
        const excluded =
        [
            "monotype", "1v1", "hackmons", "balancedhackmons", "cap", "almostanyability",
            "godlygift", "inheritance", "mixandmega", "partnersincrime", "stabmons",
            "bdspou", "letsgoou", "nationaldexmonotype", "2v2doubles", "vgc", "vgc2026regi",
        ];
        const expected = [
            ...singles.map(([tier, label]) => ({ id: `gen9${tier}`, tab: "gen9", category: "singles", label })),
            ...doubles.map(([tier, label]) => ({ id: `gen9${tier}`, tab: "gen9", category: "doubles", label })),
        ];
        const formats = [...expected.map((format) => format.id).reverse(), ...excluded.map((tier) => `gen9${tier}`)];
        resources = createSmogonFixtures(formats);
        const fetch = createSmogonFetch(resources);
        const result = await createSmogonSource({ directory, fetchResource: fetch }).getSets(["Charizard"]);
        expect(result.formats).to.deep.equal(expected);
        expect(result.sets).to.have.length(expected.length * 2);
        expect(result.unavailable).to.deep.equal([]);
        for (const format of expected)
        {
            const sets = result.sets.filter((set) => set.format === format.id);
            expect(sets.map((set) => set.name)).to.deep.equal(["Drought Offense", "Fallback"]);
            expect(sets[0].description).to.equal("Use & win.\n\n\u2022 Stay fast.");
        }
        expect(fetch.calls).to.have.length(1 + expected.length * 2);
    });

    it("reads new tiers through both library APIs with gen8 and Champions prefixes", async () =>
    {
        const formats =
        [
            "gen8doublesubers", "championsnationaldex", "championsbattlestadiumsingles", "championsvgc2026",
        ];
        resources = createSmogonFixtures(formats);
        const result = await createSmogonSource({ directory, fetchResource: createSmogonFetch(resources) }).getSets(["Charizard"]);
        expect(result.unavailable).to.deep.equal([]);
        for (const format of formats)
        {
            const sets = result.sets.filter((set) => set.format === format);
            expect(sets).to.have.length(2);
            expect(sets[0].description).to.equal("Use & win.\n\n\u2022 Stay fast.");
            expect(sets[1].name).to.equal("Fallback");
        }
    });

    it("decodes named and numeric entities and strips tags", () =>
    {
        expect(htmlToText('<h3>Title</h3><p>&lt;tag&gt; &quot;x&quot; &#39; &apos; &nbsp; &#65; &#x1F600;</p><br><br><br><h4>End</h4>')).to.equal('Title\n<tag> "x" \' \' A \ud83d\ude00\n\nEnd');
        expect(htmlToText("<p> </p>")).to.equal(null);
        expect(htmlToText(null)).to.equal(null);
        expect(htmlToText("&#9999999999;")).to.equal("\ufffd");
    });

    it("renames distinct Mega sets but skips identical base and Gmax queries", async () =>
    {
        const result = await source.getSets(["Charizard", "Charizard-Mega-X", "Charizard-Gmax", "Charizard-Mega-X", "Not a Pokemon"]);
        expect(result.sets).to.have.length(9);
        expect(new Set(result.sets.map((set) => `${set.format}/${set.name}`)).size).to.equal(9);
        for (const format of result.formats)
        {
            const sets = result.sets.filter((set) => set.format === format.id);
            expect(sets.map((set) => set.name)).to.deep.equal(["Drought Offense", "Fallback", "Drought Offense (Mega X)"]);
            expect(sets[0].species).to.equal("Charizard");
            expect(sets[2]).to.include({ species: "Charizard-Mega-X", description: "Mega set." });
            expect(sets[2].moveset.item).to.deep.equal(["Charizardite X"]);
        }
    });

    it("skips identical Mega movesets even when their descriptions differ", async () =>
    {
        for (const format of ["championsou", "gen9ou", "gen9vgc2024"])
        {
            const sets = resources[`/sets/${format}.json`];
            sets["Charizard-Mega-X"]["Drought Offense"] = { ...sets.Charizard["Drought Offense"], item: ["Charizardite X"] };
            sets.Charizard["Drought Offense"].item = ["Charizardite X"];
        }
        const result = await source.getSets(["Charizard", "Charizard-Mega-X"]);
        expect(result.sets).to.have.length(6);
        expect(result.sets.every((set) => set.species === "Charizard")).to.equal(true);
    });

    it("uses each queried Mega's suffix and preserves the base set's plain name", async () =>
    {
        for (const format of ["championsou", "gen9ou", "gen9vgc2024"])
        {
            const sets = resources[`/sets/${format}.json`];
            sets["Charizard-Mega-Y"] =
            {
                "Drought Offense": { moves: ["Fire Blast"], item: "Charizardite Y" },
            };
            sets.Kangaskhan =
            {
                "All-Out Attacker": { moves: ["Return"], item: "Life Orb" },
            };
            sets["Kangaskhan-Mega"] =
            {
                "All-Out Attacker": { moves: ["Return"], item: "Kangaskhanite" },
            };
        }
        const result = await source.getSets(
        [
            "Charizard", "Charizard-Mega-X", "Charizard-Mega-Y", "Kangaskhan", "Kangaskhan-Mega",
        ]);
        for (const format of result.formats)
        {
            const sets = result.sets.filter((set) => set.format === format.id);
            expect(sets.map((set) => set.name)).to.deep.equal(
            [
                "Drought Offense", "Fallback", "Drought Offense (Mega X)",
                "Drought Offense (Mega Y)", "All-Out Attacker", "All-Out Attacker (Mega)",
            ]);
            expect(sets[3].species).to.equal("Charizard-Mega-Y");
            expect(sets[5].species).to.equal("Kangaskhan-Mega");
        }
    });

    it("skips a renamed Mega set when its suffixed name is already used", async () =>
    {
        for (const format of ["championsou", "gen9ou", "gen9vgc2024"])
            resources[`/sets/${format}.json`].Charizard["Drought Offense (Mega X)"] = { moves: ["Flamethrower"], item: "Leftovers" };
        const result = await source.getSets(["Charizard", "Charizard-Mega-X"]);
        expect(result.sets).to.have.length(9);
        expect(result.sets.every((set) => set.species === "Charizard")).to.equal(true);
    });

    it("reports unavailable formats but retains every discovered format", async () =>
    {
        delete resources["/sets/gen9ou.json"];
        delete resources["/analyses/gen9ou.json"];
        const result = await source.getSets(["Charizard"]);
        expect(result.unavailable).to.deep.equal(["gen9ou"]);
        expect(result.formats).to.have.length(3);
        expect(result.sets).to.have.length(4);
    });

    it("falls back to sets when an entire analyses file is unavailable", async () =>
    {
        delete resources["/analyses/championsou.json"];
        const result = await source.getSets(["Charizard"]);
        expect(result.unavailable).to.deep.equal([]);
        expect(result.sets[0].description).to.equal(null);
        expect(result.sets[0].moveset.moves).to.deep.equal(["Flamethrower", "Solar Beam"]);
    });

    it("deduplicates simultaneous downloads", async () =>
    {
        const firstEvents = [];
        const secondEvents = [];
        const [first, second] = await Promise.all(
        [
            source.getSets(["Charizard"], { progress: { update: (event) => firstEvents.push(event) } }),
            source.getSets(["Charizard"], { progress: { update: (event) => secondEvents.push(event) } }),
        ]);
        expect(first).to.deep.equal(second);
        expect(firstEvents).to.deep.equal(secondEvents);
        expect(firstEvents.map((event) => event.percentage)).to.deep.equal([0, 0, 33, 66, 99]);
        expect(fetchResource.calls).to.have.length(7);
        expect(fetchResource.calls.every((call) => !new URL(call.url).pathname.includes("//") && call.options.signal instanceof AbortSignal)).to.equal(true);
    });

    it("constructs the singleton lazily and supports replacement and reset", () =>
    {
        setSmogonSource(source);
        expect(getSmogonSource()).to.equal(source);
        setSmogonSource();
        const replacement = getSmogonSource();
        expect(replacement).to.not.equal(source);
        expect(getSmogonSource()).to.equal(replacement);
    });
});
