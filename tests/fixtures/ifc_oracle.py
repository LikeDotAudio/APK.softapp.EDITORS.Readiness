# Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
# MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
"""The IFC oracle for the Readiness plan's saved .ifc: IfcOpenShell, independent of the contracts STEP codec.

    python -I tests/fixtures/ifc_oracle.py <file.ifc> <expect.json>     (prints one JSON line, exit 0 = holds)

  - ifcopenshell.validate (schema + EXPRESS rules): 0 errors
  - one apk.readiness/2 IfcWorkSchedule (PLANNED), declared in the project, controlling one IfcTask
    (INSTALLATION) per device, each assigned to its product (IfcRelAssignsToProduct)
  - Status '<code> <name>', APK_Readiness.StageCode, IfcTaskTime.Completion == stage/8 (none at d0),
    ScheduleFinish == the target date
  - eight nested stage tasks chained FINISH_START, d8 the milestone; ActualFinish on each stage reached
  - every product is contained in an IfcSpace whose name is the asset's location (bom-fm-4)
Exit 3 when IfcOpenShell is not installed (the node test then skips).
"""
import json
import sys

try:
    import ifcopenshell
    import ifcopenshell.util.element as E
    import ifcopenshell.util.sequence as Q
    import ifcopenshell.validate as V
except ImportError:
    print(json.dumps({"skip": "ifcopenshell not installed"}))
    sys.exit(3)


def main(path, expect_path):
    want = json.load(open(expect_path, encoding="utf-8"))
    f = ifcopenshell.open(path)
    problems = []
    log = V.json_logger()
    V.validate(f, log, express_rules=True)
    problems += ["validate: %s" % str(s.get("message", s))[:300] for s in log.statements]

    ws = [w for w in f.by_type("IfcWorkSchedule") if w.Identification == "apk.readiness/2"]
    if len(ws) != 1:
        print(json.dumps({"ok": False, "problems": ["%d apk.readiness/2 work schedules" % len(ws)]}))
        return 1
    ws = ws[0]
    if ws.PredefinedType != "PLANNED":
        problems.append("schedule %s" % ws.PredefinedType)
    if not any(r.RelatingContext.is_a("IfcProject") for r in ws.HasContext):
        problems.append("schedule not declared in the project")
    tasks = {t.Identification: t for t in Q.get_root_tasks(ws)}
    for d in want["devices"]:
        t = tasks.get(d["id"])
        if not t:
            problems.append("no task for %s" % d["id"])
            continue
        n = int(d["stage"][1:])
        if t.PredefinedType != "INSTALLATION" or not t.Status.startswith(d["stage"] + " "):
            problems.append("task %s: %s %s" % (d["id"], t.PredefinedType, t.Status))
        if E.get_psets(t).get("APK_Readiness", {}).get("StageCode") != d["stage"]:
            problems.append("task %s: APK_Readiness.StageCode" % d["id"])
        tt = t.TaskTime
        got = tt.Completion if tt else None
        if (n == 0 and got is not None) or (n and abs((got or 0) - n / 8) > 1e-9):
            problems.append("task %s: Completion %s, stage %s" % (d["id"], got, d["stage"]))
        if d.get("targetDate") and (not tt or not str(tt.ScheduleFinish).startswith(d["targetDate"])):
            problems.append("task %s: ScheduleFinish %s" % (d["id"], tt and tt.ScheduleFinish))
        products = [r.RelatingProduct for r in t.HasAssignments if r.is_a("IfcRelAssignsToProduct")]
        if len(products) != 1:
            problems.append("task %s: %d products" % (d["id"], len(products)))
        else:
            space = E.get_container(products[0])
            if want.get("contained", True) and (not space or space.Name != (d.get("location") or "Unplaced")):
                problems.append("device %s: in %s, location %r" % (d["id"], space and space.Name, d.get("location")))
        stages = Q.get_nested_tasks(t)
        if [s.Name for s in stages][-1:] != ["Air Ready"] or len(stages) != 8 or not stages[-1].IsMilestone:
            problems.append("task %s: stage tasks %s" % (d["id"], [s.Name for s in stages]))
        for k, s in enumerate(stages, 1):
            nxt = [r for r in s.IsPredecessorTo if r.SequenceType == "FINISH_START"]
            if k < 8 and (len(nxt) != 1 or nxt[0].RelatedProcess != stages[k]):
                problems.append("task %s: d%d is not followed by d%d" % (d["id"], k, k + 1))
            when = (d.get("reached") or {}).get("d%d" % k)
            got = s.TaskTime.ActualFinish if s.TaskTime else None
            if (when or None) != (str(got)[:10] if got else None):
                problems.append("task %s d%d: ActualFinish %s, reached %s" % (d["id"], k, got, when))
    if len(tasks) != len(want["devices"]):
        problems.append("%d tasks for %d devices" % (len(tasks), len(want["devices"])))
    print(json.dumps({"ok": not problems, "problems": problems[:40], "validate_errors": len(log.statements), "tasks": len(tasks)}))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
