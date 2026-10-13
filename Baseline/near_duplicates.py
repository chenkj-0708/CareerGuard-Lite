"""Lossless 5-token-shingle Jaccard candidate audit; no labels or learned model.

A global rare-first order and length/prefix filters avoid all N*(N-1)/2
intersections. Every qualifying pair is checked with its exact set overlap.
No MinHash/LSH sampling, top-K or candidate cap can silently miss a pair.
"""
from collections import Counter, defaultdict
from fractions import Fraction
import hashlib
import json
import math
import re
import time
import unicodedata

NORMALISATION_VERSION = "HashNormalise-DUP-v1"
SHINGLE_SIZE = 5
DEFAULT_THRESHOLD = .80


def normalise_text(text):
    return " ".join(unicodedata.normalize("NFKC",str(text)).lower().split())


def tokenise(text):
    return re.findall(r"[^\W_]+",normalise_text(text),flags=re.UNICODE)


class UnionFind:
    def __init__(self,n):self.parent=list(range(n));self.size=[1]*n
    def find(self,i):
        while self.parent[i]!=i:
            self.parent[i]=self.parent[self.parent[i]];i=self.parent[i]
        return i
    def union(self,a,b):
        a=self.find(a);b=self.find(b)
        if a==b:return
        if self.size[a]<self.size[b]:a,b=b,a
        self.parent[b]=a;self.size[a]+=self.size[b]


def shingle_sets(texts):
    tokens={};shingles={};sets=[];normalised=[]
    for i,text in enumerate(texts):
        norm=normalise_text(text);normalised.append(norm)
        ids=[]
        for token in tokenise(norm):
            if token not in tokens:tokens[token]=len(tokens)
            ids.append(tokens[token])
        values=set()
        for start in range(len(ids)-SHINGLE_SIZE+1):
            key=tuple(ids[start:start+SHINGLE_SIZE])
            if key not in shingles:shingles[key]=len(shingles)
            values.add(shingles[key])
        sets.append(values)
        if (i+1)%4000==0:print(f"Shingled {i+1}/{len(texts)} records",flush=True)
    return sets,normalised


def similarity_join(sets,threshold=DEFAULT_THRESHOLD):
    if not 0<threshold<=1:raise ValueError("Jaccard threshold must be in (0,1]")
    ratio=Fraction(str(threshold));p,q=ratio.numerator,ratio.denominator
    frequencies=Counter(value for values in sets for value in values)
    ordered=[sorted(values,key=lambda v:(frequencies[v],v)) for values in sets]
    lengths=[len(values) for values in sets]
    index=defaultdict(list);pairs=[];checked=0;candidate_count=0
    ids=sorted(range(len(sets)),key=lambda i:(lengths[i],i))
    for done,a in enumerate(ids):
        n=lengths[a]
        if not n:continue
        minimum=(p*n+q-1)//q
        prefix=n-minimum+1
        candidates=set()
        for value in ordered[a][:prefix]:
            candidates.update(b for b in index[value] if lengths[b]>=minimum)
        candidate_count+=len(candidates)
        for b in sorted(candidates):
            # |A intersection B| >= ceil(t/(1+t) * (|A|+|B|)).
            required=(p*(n+lengths[b])+(p+q)-1)//(p+q)
            smaller,larger=(sets[b],sets[a]) if lengths[b]<=n else (sets[a],sets[b])
            overlap=sum(value in larger for value in smaller);checked+=1
            if overlap>=required:
                union=n+lengths[b]-overlap
                pairs.append((min(a,b),max(a,b),overlap/union,overlap,union))
        for value in ordered[a][:prefix]:index[value].append(a)
        if (done+1)%4000==0:print(f"Similarity join {done+1}/{len(sets)}; {len(pairs)} qualifying pairs",flush=True)
    return sorted(pairs),{"candidate_pairs_checked":checked,"prefix_candidates":candidate_count,"unique_shingles":len(frequencies)}


def audit_texts(texts,identifiers,threshold=DEFAULT_THRESHOLD):
    if len(set(map(str,identifiers)))!=len(identifiers):raise ValueError("Duplicate posting IDs")
    start=time.perf_counter();sets,norm=shingle_sets(texts);pairs,stats=similarity_join(sets,threshold)
    exact=defaultdict(list)
    for i,value in enumerate(norm):exact[hashlib.sha256(value.encode("utf-8")).hexdigest()].append(i)
    uf=UnionFind(len(texts));exact_edges=[]
    for digest,members in exact.items():
        for b in members[1:]:uf.union(members[0],b);exact_edges.append((members[0],b,digest))
    for a,b,score,overlap,union in pairs:uf.union(a,b)
    components=defaultdict(list)
    for i in range(len(texts)):components[uf.find(i)].append(i)
    group_ids=[None]*len(texts)
    for members in components.values():
        group="dup-"+hashlib.sha256("\n".join(sorted(str(identifiers[i]) for i in members)).encode()).hexdigest()[:24]
        for i in members:group_ids[i]=group
    summary={"normalisation_version":NORMALISATION_VERSION,"shingle_size":SHINGLE_SIZE,"jaccard_threshold":threshold,
             "rows":len(texts),"independent_groups":len(components),"multi_record_groups":sum(len(v)>1 for v in components.values()),
             "largest_group":max(map(len,components.values()),default=0),"exact_text_duplicate_groups":sum(len(v)>1 for v in exact.values()),
             "exact_text_duplicate_extra_rows":sum(len(v)-1 for v in exact.values()),"near_duplicate_pairs":len(pairs),
             "short_text_without_five_token_shingles":sum(not values for values in sets),"audit_seconds":time.perf_counter()-start,
             "policy":"All >=threshold candidates are conservatively co-grouped; no human SAME_GROUP confirmation is asserted.",**stats}
    return {"groups":group_ids,"pairs":pairs,"exact_edges":exact_edges,"normalised_hashes":[hashlib.sha256(v.encode()).hexdigest() for v in norm],"summary":summary}


def cross_split_audit(audit,splits):
    near=[(a,b,score) for a,b,score,overlap,union in audit["pairs"] if splits[a]!=splits[b]]
    exact=[(a,b) for a,b,digest in audit["exact_edges"] if splits[a]!=splits[b]]
    group_splits=defaultdict(set)
    for group,split in zip(audit["groups"],splits):group_splits[group].add(split)
    return {"near_pairs":near,"exact_pairs":exact,"group_leakage_count":sum(len(v)>1 for v in group_splits.values()),
            "cross_split_near_pair_count":len(near),"cross_split_exact_edge_count":len(exact),
            "train_test_near_pair_count":sum({splits[a],splits[b]}=={"train","test"} for a,b,score in near),
            "passed":not near and not exact and all(len(v)==1 for v in group_splits.values())}
