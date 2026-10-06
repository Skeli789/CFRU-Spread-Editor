const { expect } = require("chai");
const crypto = require("crypto");
const { createProgressStore, PROGRESS_LABELS } = require("../../services/progress");

describe("Operation progress storage", () =>
{
    it("retains every spread import comparison stage instead of the earlier loading label", () =>
    {
        const store = createProgressStore();
        const id = crypto.randomUUID();
        const handle = store.start(id, PROGRESS_LABELS.spreads);
        for (const label of [PROGRESS_LABELS.exportBaseline, PROGRESS_LABELS.currentSpreads, PROGRESS_LABELS.incomingSpreads,
            PROGRESS_LABELS.compareSpreads, PROGRESS_LABELS.prepareComparisons])
        {
            handle.update({ percentage: 54, label });
            expect(store.snapshot(id).label).to.equal(label);
        }
    });

    it("clamps monotonic integer progress, strips unsafe labels and detaches snapshots", () =>
    {
        const store = createProgressStore();
        const id = crypto.randomUUID();
        const handle = store.start(id, "C:/private/repository");
        expect(store.snapshot(id)).to.deep.equal({ percentage: 0, label: PROGRESS_LABELS.starting, status: "running" });
        handle.update({ percentage: 42.9, label: PROGRESS_LABELS.reading });
        handle.update({ percentage: -5, label: "/private/source.txt" });
        handle.update({ percentage: NaN });
        const snapshot = store.snapshot(id);
        expect(snapshot).to.deep.equal({ percentage: 42, label: PROGRESS_LABELS.reading, status: "running" });
        snapshot.percentage = 100;
        expect(store.snapshot(id).percentage).to.equal(42);
        handle.update({ percentage: 1000 });
        expect(store.snapshot(id).percentage).to.equal(99);
        handle.complete();
        handle.fail();
        handle.update({ percentage: 1, label: PROGRESS_LABELS.reading });
        expect(store.snapshot(id)).to.deep.equal({ percentage: 100, label: PROGRESS_LABELS.complete, status: "complete" });
    });

    it("keeps failed operations below 100 and never lets late completion replace failure", () =>
    {
        const store = createProgressStore();
        const id = crypto.randomUUID();
        const handle = store.start(id);
        handle.update({ percentage: 99 });
        handle.fail();
        handle.complete();
        expect(store.snapshot(id)).to.deep.equal({ percentage: 99, label: PROGRESS_LABELS.failed, status: "failed" });
    });

    it("rejects invalid IDs and reports polls before registration without creating records", () =>
    {
        const store = createProgressStore();
        for (const id of [undefined, "", "invalid", "../private", [], crypto.randomUUID() + "x"])
        {
            expect(() => store.start(id)).to.throw().with.property("code", "INVALID_PROGRESS_ID");
            expect(() => store.snapshot(id)).to.throw().with.property("status", 400);
        }
        expect(() => store.snapshot(crypto.randomUUID())).to.throw().with.property("code", "PROGRESS_NOT_FOUND");
    });

    it("rejects collisions including case aliases, active and completed retries", () =>
    {
        const store = createProgressStore();
        const id = crypto.randomUUID();
        const handle = store.start(id);
        expect(() => store.start(id.toUpperCase())).to.throw().with.property("code", "PROGRESS_ID_IN_USE");
        handle.complete();
        expect(() => store.start(id)).to.throw().with.property("status", 409);
        expect(store.snapshot(id).status).to.equal("complete");
    });

    it("expires lazily after 15 minutes without polls keeping records alive", () =>
    {
        let time = 0;
        const store = createProgressStore({ now: () => time });
        const id = crypto.randomUUID();
        const stale = store.start(id);
        stale.update({ percentage: 50 });
        time = 15 * 60 * 1000 - 1;
        expect(store.snapshot(id).percentage).to.equal(50);
        time++;
        expect(() => store.snapshot(id)).to.throw().with.property("code", "PROGRESS_NOT_FOUND");
        const replacement = store.start(id);
        stale.complete();
        stale.update({ percentage: 99 });
        expect(store.snapshot(id).percentage).to.equal(0);
        replacement.complete();
        expect(store.snapshot(id).status).to.equal("complete");
    });

    it("bounds retained records without evicting running operations", () =>
    {
        const store = createProgressStore({ maxRecords: 2 });
        const first = crypto.randomUUID();
        const second = crypto.randomUUID();
        const third = crypto.randomUUID();
        const firstHandle = store.start(first);
        store.start(second);
        expect(() => store.start(third)).to.throw().with.property("code", "PROGRESS_BUSY");
        firstHandle.fail();
        store.start(third);
        expect(() => store.snapshot(first)).to.throw().with.property("code", "PROGRESS_NOT_FOUND");
        expect(store.snapshot(second).status).to.equal("running");
        expect(store.snapshot(third).status).to.equal("running");
    });
});
