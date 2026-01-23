# Control Tower Dashboard - Task Tracking

## Objective
Transform the RiskRadar dashboard into a **Control Tower for Natural Events** with enhanced UI/UX, explainability, and actionable features. **Frontend-only changes** - no Python backend modifications.

---

## Phase 1: Core Dashboard Redesign 🎯 ✅
- [x] **1.1** Complete dashboard UI redesign with modern Control Tower aesthetic
- [x] **1.2** Top 10 Risk Sites panel with Ampel-System (Rot/Gelb/Grün)
- [x] **1.3** Lead-Time display ("kritisch in Xh" statt nur "kritisch")
- [x] **1.4** Risk explainability ("Warum") - show top 3 risk drivers per site

## Phase 2: Site Enrichment Data 📊 ✅
- [x] **2.1** Create `site_metadata.json` with site types and criticality
- [x] **2.2** Add Business Impact Context to UI (Hub vs. Depot, Durchsatz)
- [x] **2.3** Implement Impact-Score visualization (hazard vs. business impact)

## Phase 3: Runbooks / Playbooks 📋 ✅
- [x] **3.1** Create `playbooks.json` with event-type specific runbooks
- [x] **3.2** Playbook panel UI with measures, owners, SLAs, checklists
- [x] **3.3** Link playbooks to risk events in site details

## Phase 4: Alert Configuration UI ⚡
- [ ] **4.1** Alert rules panel (threshold-based, configurable in UI)
- [ ] **4.2** Alert history / log panel
- [ ] **4.3** LocalStorage persistence for alert settings

## Phase 5: Simulation View (Ausblick) 🔮
- [ ] **5.1** "Was-wäre-wenn" scenario selector
- [ ] **5.2** Rerouting visualization mockup
- [ ] **5.3** Cost/delay impact display (conceptual)

---

## Current Focus
[ ] Phase 1 - Starting with dashboard redesign
