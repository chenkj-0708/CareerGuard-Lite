"""Thesis Chapter 3: paired independent-group ordinal-error analysis.

No groups, overlap categories, labels or independent validity gates are inferred
from URLs, platform names, scorer reasons or historical dashboard labels.
"""
import math
import random
import statistics
from collections import defaultdict

GRADE = {"low": 0, "uncertain": 1, "elevated": 2}
SENSITIVITIES = ("priorWeight", "rawScaling", "lowerBoundaries", "upperBoundaries")

def kappa(pairs, weighted=True):
    if not pairs: return None
    n = len(pairs)
    observed = sum(abs(a-b)/2 if weighted else int(a != b) for a,b in pairs)/n
    left = [sum(a==i for a,b in pairs)/n for i in range(3)]
    right = [sum(b==i for a,b in pairs)/n for i in range(3)]
    expected = sum(left[i]*right[j]*(abs(i-j)/2 if weighted else int(i!=j)) for i in range(3) for j in range(3))
    return round(1-observed/expected, 6) if expected else None

def class_metrics(rows, key):
    pairs = [(GRADE[r["groundTruth"]], GRADE[prediction(r,key)]) for r in rows]
    matrix = [[sum(a==i and b==j for a,b in pairs) for j in range(3)] for i in range(3)]
    classes = {}
    for label,i in GRADE.items():
        tp=matrix[i][i]; fp=sum(matrix[j][i] for j in range(3) if j!=i); fn=sum(matrix[i][j] for j in range(3) if j!=i)
        p=tp/(tp+fp) if tp+fp else 0; recall=tp/(tp+fn) if tp+fn else 0
        classes[label]={"precision":p,"recall":recall,"f1":2*p*recall/(p+recall) if p+recall else 0,"support":sum(matrix[i])}
    return {"labels":list(GRADE),"confusion_matrix":matrix,"per_class":classes,
            "macro_f1":statistics.mean(v["f1"] for v in classes.values()),
            "linear_weighted_kappa":kappa(pairs), "unweighted_kappa":kappa(pairs,False)}

def prediction(row,key):
    if key in SENSITIVITIES: return row["baselines"]["sensitivities"][key]["tier"]
    return row["baselines"][key]["tier"]

def group_errors(rows,key):
    groups=defaultdict(list)
    for row in rows: groups[row["groupId"]].append(abs(GRADE[prediction(row,key)]-GRADE[row["groundTruth"]]))
    return {group:statistics.mean(values) for group,values in groups.items()}

def maoe(rows,key):
    errors=group_errors(rows,key)
    return statistics.mean(errors.values()) if errors else None

def percentile(values,probability):
    values=sorted(values); position=(len(values)-1)*probability; lo=math.floor(position); hi=math.ceil(position)
    return values[lo]+(values[hi]-values[lo])*(position-lo)

def compare(rows,single,fused="multiSignal",resamples=10000,seed=42):
    left=group_errors(rows,single); right=group_errors(rows,fused)
    deltas={g:left[g]-right[g] for g in left}
    if not deltas: return {"groups":0,"delta_maoe":None}
    rng=random.Random(seed); values=list(deltas.values())
    samples=[sum(rng.choices(values,k=len(values)))/len(values) for _ in range(resamples)] if resamples else []
    corrections=sum(abs(GRADE[prediction(r,fused)]-GRADE[r["groundTruth"]]) < abs(GRADE[prediction(r,single)]-GRADE[r["groundTruth"]]) for r in rows)
    worsenings=sum(abs(GRADE[prediction(r,fused)]-GRADE[r["groundTruth"]]) > abs(GRADE[prediction(r,single)]-GRADE[r["groundTruth"]]) for r in rows)
    single_k=class_metrics(rows,single)["linear_weighted_kappa"]; fused_k=class_metrics(rows,fused)["linear_weighted_kappa"]
    return {"groups":len(deltas),"scenarios":len(rows),"single_group_maoe":statistics.mean(left.values()),
            "fused_group_maoe":statistics.mean(right.values()),"delta_maoe":statistics.mean(values),
            "delta_direction":"positive favours fusion", "group_deltas":deltas,
            "cluster_bootstrap_95_ci":[percentile(samples,.025),percentile(samples,.975)] if samples else None,
            "bootstrap_resamples":resamples,"bootstrap_seed":seed,"corrections":corrections,"worsenings":worsenings,
            "ties":len(rows)-corrections-worsenings,"single_linear_weighted_kappa":single_k,
            "fused_linear_weighted_kappa":fused_k,"delta_linear_weighted_kappa":fused_k-single_k if fused_k is not None and single_k is not None else None}

def support(rows):
    return {"groups":len({r["groupId"] for r in rows}),"scenarios":len(rows),
            "class_groups":{label:len({r["groupId"] for r in rows if r["groundTruth"]==label}) for label in GRADE}}

def evaluate_rq1(records,contract=None,resamples=10000):
    contract=contract or {}; exclusions=defaultdict(int); eligible=[]; seen={}; problems=[]
    for row in records:
        if row.get("evaluationOverride") or row.get("synthetic"):
            exclusions["functional_or_synthetic"]+=1; continue
        if row.get("groundTruth") not in GRADE:
            exclusions["reference_insufficient_or_unlabelled"]+=1; continue
        if row.get("page",{}).get("pageStatus") in ("unsupported","extraction-limited") or row.get("page",{}).get("extractionStatus") == "unavailable":
            exclusions["extraction_failure"]+=1; continue
        if not isinstance(row.get("groupId"), str) or not row["groupId"] or row.get("split") not in ("validation","test") or row.get("overlapCategory") not in ("DIRECT","RELATED","LOWER-OVERLAP"):
            exclusions["missing_group_split_or_overlap"]+=1; continue
        if row.get("configId") != "thesis-primary-50-50-v1":
            exclusions["legacy_or_unknown_configuration"]+=1; continue
        if any(row.get("baselines",{}).get(k,{}).get("tier") not in GRADE for k in ("textOnly","metadataOnly","multiSignal")):
            exclusions["incomplete_paired_prediction"]+=1; continue
        key=row.get("scenarioId") or row.get("id")
        if not key:
            exclusions["missing_scenario_id"]+=1; continue
        signature=(row["groupId"],row["split"],row["groundTruth"],row["overlapCategory"],tuple(prediction(row,k) for k in ("textOnly","metadataOnly","multiSignal")))
        if key in seen:
            exclusions["technical_repeat"]+=1
            if seen[key]!=signature: problems.append("conflicting_repeat_predictions_or_labels")
            continue
        seen[key]=signature; eligible.append(row)
    val=[r for r in eligible if r["split"]=="validation"]; test=[r for r in eligible if r["split"]=="test"]
    if {r["groupId"] for r in val} & {r["groupId"] for r in test}: problems.append("cross_split_group_leakage")
    output={"analysisVersion":"rq1-thesis-v1","target":"project advisory reference, not fraud truth",
            "exclusions":dict(exclusions),"validation_support":support(val),"test_support":support(test),"problems":problems}
    if not val or not test or problems:
        output.update({"status":"Inconclusive","reason":"Missing eligible paired partitions or unresolved integrity errors"}); return output
    validation={k:maoe(val,k) for k in ("textOnly","metadataOnly")}
    tie=contract.get("validationTieBreak")
    if validation["textOnly"]==validation["metadataOnly"] and tie not in validation:
        output.update({"status":"Inconclusive","reason":"Validation tie rule was not predeclared","validation_maoe":validation}); return output
    single=min(validation,key=lambda k:(validation[k],0 if k==tie else 1))
    primary=compare(test,single,resamples=resamples)
    lower=[r for r in test if r["overlapCategory"]=="LOWER-OVERLAP"]
    lower_result=compare(lower,single,resamples=resamples)
    strata={category:compare([r for r in test if r["overlapCategory"]==category],single,resamples=resamples) for category in ("DIRECT","RELATED","LOWER-OVERLAP")}
    sensitivity={}
    for key in SENSITIVITIES:
        if all(r.get("baselines",{}).get("sensitivities",{}).get(key,{}).get("tier") in GRADE for r in test):
            sensitivity[key]={"overall":compare(test,single,key,resamples=resamples),"lower_overlap":compare(lower,single,key,resamples=resamples)}
        else: sensitivity[key]={"status":"missing paired sensitivity predictions"}
    distributions={}
    for key in ("textOnly","metadataOnly","multiSignal"):
        scores=[r["baselines"][key]["score"] for r in test]
        distributions[key]={"min":min(scores),"max":max(scores),"mean":statistics.mean(scores),"floor_fraction":sum(v==5 for v in scores)/len(scores),"saturation_fraction":sum(v==100 for v in scores)/len(scores),"scores":scores}
    annotations=[tuple(GRADE[label] for label in r.get("annotatorLabels",[])) for r in eligible if len(r.get("annotatorLabels",[]))==2 and all(label in GRADE for label in r["annotatorLabels"])]
    agreement={"pairs":len(annotations),"raw_agreement":sum(a==b for a,b in annotations)/len(annotations) if annotations else None,"linear_weighted_kappa":kappa(annotations),"unweighted_kappa":kappa(annotations,False),"confusion_matrix":[[sum(a==i and b==j for a,b in annotations) for j in range(3)] for i in range(3)]}
    missing=[]
    for category in ("DIRECT", "RELATED", "LOWER-OVERLAP"):
        strata[category]["support"] = support([r for r in test if r["overlapCategory"] == category])
    for gate in ("sealedBeforeHeldOut","precisionJustified","conformancePassed","leakageAuditPassed","overlapTaxonomySealed"):
        if contract.get(gate) is not True: missing.append(gate)
    for name,rows in (("validation",val),("test",test)):
        counts=support(rows)
        if counts["groups"]<15 or any(n<5 for n in counts["class_groups"].values()): missing.append(name+"_independent_support")
    if type(contract.get("unresolvedCrossSplitPairs")) is not int or contract["unresolvedCrossSplitPairs"] != 0:
        missing.append("zero_unresolved_cross_split_pairs")
    lower_min=contract.get("lowerOverlapMinGroups")
    if type(lower_min) is not int or lower_min < 1 or support(lower)["groups"]<lower_min: missing.append("predeclared_lower_overlap_support")
    lower_class_min = contract.get("lowerOverlapClassMinGroups")
    if type(lower_class_min) is not int or lower_class_min < 1 or any(n < lower_class_min for n in support(lower)["class_groups"].values()):
        missing.append("predeclared_lower_overlap_class_support")
    if agreement["linear_weighted_kappa"] is None or agreement["linear_weighted_kappa"] < .40: missing.append("reference_reliability")
    if any("overall" not in value for value in sensitivity.values()): missing.append("complete_sensitivity_set")
    reversal=primary["delta_maoe"]>0 and (lower_result["delta_maoe"] is None or lower_result["delta_maoe"]<=0 or primary["delta_linear_weighted_kappa"] is None or primary["delta_linear_weighted_kappa"]<0 or any(value.get("overall",{}).get("delta_maoe",-1)<0 or value.get("lower_overlap",{}).get("delta_maoe",-1)<0 for value in sensitivity.values()))
    if reversal: missing.append("metric_or_configuration_direction_reversal")
    for rows in (val, test):
        for row in rows:
            if row.get("annotationProtocolVersion") != contract.get("annotationProtocolVersion") or not contract.get("annotationProtocolVersion"):
                if "annotation_protocol_version" not in missing: missing.append("annotation_protocol_version")
                break
    status="Inconclusive" if missing else "Supported" if primary["delta_maoe"]>0 and lower_result["delta_maoe"]>0 else "Not Supported"
    # Partially Supported requires a separately sealed synthesis rule; never invent one from results.
    output.update({"status":status,"claim_scope":"pilot/feasibility effect estimation" if missing else "predeclared grouped advisory-reference comparison",
        "missing_gates":missing,"validation_maoe":validation,"selected_single_branch":single,"primary":primary,"lower_overlap":lower_result,
        "overlap_strata":strata,"sensitivities":sensitivity,"branch_distributions":distributions,"reference_agreement":agreement,
        "class_metrics":{key:class_metrics(test,key) for key in ("textOnly","metadataOnly","multiSignal")}})
    return output
