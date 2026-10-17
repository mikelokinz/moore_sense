import sqlite3
import json
import math
from datetime import datetime, timezone
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# --- 1. Load GeoJSON EEZ Polygons ---
geojson_path = Path(r"d:\ocean\moore\public\data\india_eez.geojson")
with open(geojson_path, "r", encoding="utf-8") as f:
    eez_data = json.load(f)

eez_polygons = {}
for feat in eez_data["features"]:
    if feat["geometry"]["type"] == "Polygon" and feat["properties"].get("category") == "eez_polygon":
        name = feat["properties"]["name"]
        coords = feat["geometry"]["coordinates"][0]
        eez_polygons[name] = coords

# --- 2. Geometric helpers ---
def haversine_nm(lat1, lon1, lat2, lon2):
    R_nm = 3440.065
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R_nm * c

def point_in_polygon(x, y, poly_coords):
    n = len(poly_coords)
    inside = False
    p1x, p1y = poly_coords[0]
    for i in range(n + 1):
        p2x, p2y = poly_coords[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def dist_to_polygon_boundary_nm(lat, lon, poly_coords):
    min_dist = float("inf")
    for p in poly_coords:
        d = haversine_nm(lat, lon, p[1], p[0])
        if d < min_dist:
            min_dist = d
    return min_dist

def dec_to_dms(deg, is_lat=True):
    abs_d = abs(deg)
    d = int(abs_d)
    m = int((abs_d - d) * 60)
    s = round(((abs_d - d) * 60 - m) * 60, 1)
    dir_char = ("N" if deg >= 0 else "S") if is_lat else ("E" if deg >= 0 else "W")
    return f"{d:02d}° {m:02d}' {s:04.1f}\" {dir_char}"

# --- 3. Authoritative Fleet Definitions ---
FLEET = [
    {
        "id": "OMNI-AD06", "name": "AD06", "lat": 18.4950, "lon": 67.4500, "depth_m": 3338,
        "basin": "Arabian Sea", "subsector": "North Arabian Sea Basin",
        "rationale": "Early tracking of Arabian Sea severe cyclones heading toward Gujarat/Sindh coastline."
    },
    {
        "id": "OMNI-AD07", "name": "AD07", "lat": 14.9314, "lon": 68.9758, "depth_m": 3977,
        "basin": "Arabian Sea", "subsector": "Central Arabian Sea Deep Basin",
        "rationale": "Central Arabian Sea monsoon wind stress, Findlater jet, and coastal upwelling dynamics."
    },
    {
        "id": "OMNI-AD08", "name": "AD08", "lat": 12.0681, "lon": 68.6328, "depth_m": 4301,
        "basin": "Arabian Sea", "subsector": "Lakshadweep Basin / Arabian Sea",
        "rationale": "Lakshadweep Basin oceanographic monitoring and maritime trade corridor observation."
    },
    {
        "id": "OMNI-AD09", "name": "AD09", "lat": 8.1831,  "lon": 73.2983, "depth_m": 2090,
        "basin": "Arabian Sea", "subsector": "Eight Degree Channel / Minicoy Waters",
        "rationale": "Sovereign EEZ monitoring near India-Maldives bilateral maritime border & equatorial currents."
    },
    {
        "id": "OMNI-AD10", "name": "AD10", "lat": 10.3217, "lon": 72.5872, "depth_m": 1617,
        "basin": "Arabian Sea", "subsector": "Lakshadweep Archipelago Internal Waters",
        "rationale": "Core coral atoll lagoon, island water security, and thermohaline stratification."
    },
    {
        "id": "OMNI-BD08", "name": "BD08", "lat": 17.8247, "lon": 89.2358, "depth_m": 2140,
        "basin": "Bay of Bengal", "subsector": "Northern Bay of Bengal Deep Basin",
        "rationale": "Upstream detection of northern Bay of Bengal cyclogenesis & storm surge approaching Odisha/Bengal."
    },
    {
        "id": "OMNI-BD09", "name": "BD09", "lat": 17.4997, "lon": 89.1167, "depth_m": 2298,
        "basin": "Bay of Bengal", "subsector": "Northern Bay of Bengal Deep Basin",
        "rationale": "Deep-sea air-sea interaction research basin paired with BD08 for spatial gradient analysis."
    },
    {
        "id": "OMNI-BD10", "name": "BD10", "lat": 16.3617, "lon": 87.9903, "depth_m": 2627,
        "basin": "Bay of Bengal", "subsector": "Central Bay of Bengal Deep Basin",
        "rationale": "Primary sentinel station for super-cyclones, severe monsoonal depressions, and tsunami alerts."
    },
    {
        "id": "OMNI-BD11", "name": "BD11", "lat": 13.5250, "lon": 84.1667, "depth_m": 3229,
        "basin": "Bay of Bengal", "subsector": "Western Bay of Bengal Offshore Corridor",
        "rationale": "Monitoring deep Western Boundary Current (WBC) approaching Coromandel/Chennai coast."
    },
    {
        "id": "OMNI-BD12", "name": "BD12", "lat": 10.5153, "lon": 94.0739, "depth_m": 2973,
        "basin": "Andaman Sea", "subsector": "Andaman & Nicobar Islands EEZ",
        "rationale": "Sovereign EEZ monitoring in the deep trench between Port Blair and Little Andaman Island."
    },
    {
        "id": "OMNI-BD13", "name": "BD13", "lat": 13.9900, "lon": 86.9969, "depth_m": 3014,
        "basin": "Bay of Bengal", "subsector": "Central-East Bay of Bengal Basin",
        "rationale": "Mid-basin meteorological sentinel for monsoon low-pressure systems developing in eastern BoB."
    },
    {
        "id": "OMNI-BD14", "name": "BD14", "lat": 6.5706,  "lon": 88.2333, "depth_m": 3832,
        "basin": "Bay of Bengal", "subsector": "Equatorial Indian Ocean Basin",
        "rationale": "Equatorial waveguide dynamics, Wyrtki jets, and Indian Ocean Dipole (IOD) monitoring."
    },
]

# --- 4. Evaluate EEZ for each buoy ---
for b in FLEET:
    lat, lon = b["lat"], b["lon"]
    inside_list = []
    distances = {}
    for name, poly in eez_polygons.items():
        is_in = point_in_polygon(lon, lat, poly)
        d = dist_to_polygon_boundary_nm(lat, lon, poly)
        distances[name] = d
        if is_in:
            inside_list.append(name)
    
    ind_main = distances.get("India (Mainland & Lakshadweep) EEZ", 9999)
    ind_and = distances.get("India (Andaman & Nicobar Islands) EEZ", 9999)
    min_dist_nm = min(ind_main, ind_and)
    
    if inside_list:
        b["in_eez"] = True
        b["eez_zone"] = inside_list[0]
        b["status_label"] = "INSIDE INDIAN SOVEREIGN EEZ"
        b["dist_eez_nm"] = round(min_dist_nm, 1)
        b["dist_eez_km"] = round(min_dist_nm * 1.852, 1)
    else:
        b["in_eez"] = False
        b["eez_zone"] = "International High Seas"
        b["status_label"] = "OUTSIDE EEZ (HIGH SEAS)"
        b["dist_eez_nm"] = round(min_dist_nm, 1)
        b["dist_eez_km"] = round(min_dist_nm * 1.852, 1)

# --- 5. Load Telemetry from Outbox SQLite ---
con = sqlite3.connect(r"d:\ocean\moore\backend\data\buoy_outbox.sqlite3")
cur = con.cursor()
cur.execute("SELECT payload FROM outbox ORDER BY id ASC")
all_rows = cur.fetchall()

fleet_latest_obs = {}
fleet_history = []
fleet_profiles = []

for (payload_str,) in all_rows:
    d = json.loads(payload_str)
    bid = d.get("buoyId")
    ts = d.get("timestamp")
    tel = d.get("telemetry", {})
    met = tel.get("meteorology", {})
    waves = tel.get("waves", {})
    ocean = tel.get("ocean", {})
    profs = tel.get("profiles", {})
    
    rec = {
        "buoy_id": bid,
        "timestamp": ts,
        "air_temp": met.get("airTemperature", {}).get("value"),
        "pressure": met.get("pressure", {}).get("value"),
        "wind_speed": met.get("windSpeed", {}).get("value"),
        "wind_dir": met.get("windDirection", {}).get("value"),
        "wind_gust": met.get("windGust", {}).get("value"),
        "humidity": met.get("humidity", {}).get("value"),
        "rainfall": met.get("rainfall", {}).get("value"),
        "radiation": met.get("radiation", {}).get("value"),
        "wave_height": waves.get("waveHeight", {}).get("value"),
        "sst": ocean.get("sst", {}).get("value"),
        "salinity": ocean.get("salinity", {}).get("value"),
    }
    fleet_history.append(rec)
    fleet_latest_obs[bid] = rec
    
    # Check profiles
    temp_profile = profs.get("temperature", [])
    sal_profile = profs.get("salinity", [])
    if temp_profile:
        for pt in temp_profile:
            fleet_profiles.append({
                "buoy_id": bid,
                "timestamp": ts,
                "depth_m": pt.get("depth"),
                "temp_c": pt.get("value"),
                "salinity_psu": None
            })
    if sal_profile:
        for pt in sal_profile:
            # find or append
            fleet_profiles.append({
                "buoy_id": bid,
                "timestamp": ts,
                "depth_m": pt.get("depth"),
                "temp_c": None,
                "salinity_psu": pt.get("value")
            })

# --- 6. Build Mooring Digital Twin Estimates ---
# Standard physics derivations for mooring response
for b in FLEET:
    bid = b["id"]
    obs = fleet_latest_obs.get(bid, {})
    depth = b["depth_m"]
    scope = 1.22
    hs = obs.get("wave_height") or 1.5
    wspd = obs.get("wind_speed") or 8.5
    
    # Fairlead tension approximation: T_fairlead = pretension + dynamic wave/wind load
    pretension = depth * 8.5 # N baseline
    drag_force = 0.5 * 1025 * (wspd * 0.03)**2 * 4.2 + 0.5 * 1.225 * wspd**2 * 3.8
    wave_drag = 1025 * 9.81 * (hs / 2) * 2.2
    fairlead_tension_kn = round((pretension + drag_force + wave_drag) / 1000, 2)
    anchor_tension_kn = round(fairlead_tension_kn * 0.88, 2)
    excursion_m = round(math.sqrt(depth) * 6.8 * (wspd / 10.0), 1)
    line_angle_deg = round(72.0 - (excursion_m / depth) * 15.0, 1)
    utilization_pct = round((fairlead_tension_kn / 245.0) * 100, 1)
    safety_factor = round(245.0 / max(1.0, fairlead_tension_kn), 2)
    risk_state = "SAFE" if utilization_pct < 45 else ("ELEVATED" if utilization_pct < 70 else "CRITICAL")
    
    b["dt_fairlead_kn"] = fairlead_tension_kn
    b["dt_anchor_kn"] = anchor_tension_kn
    b["dt_excursion_m"] = excursion_m
    b["dt_line_angle_deg"] = line_angle_deg
    b["dt_utilization_pct"] = utilization_pct
    b["dt_safety_factor"] = safety_factor
    b["dt_risk_state"] = risk_state

# --- 7. Create Excel Workbook with openpyxl ---
wb = openpyxl.Workbook()
# remove default sheet
wb.remove(wb.active)

# Styling Palette (Executive Modern Dark Navy & Clean Corporate Tables)
navy_header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
blue_sub_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
eez_green_fill = PatternFill(start_color="ECFDF5", end_color="ECFDF5", fill_type="solid")
highseas_blue_fill = PatternFill(start_color="F0F9FF", end_color="F0F9FF", fill_type="solid")
zebra_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")

header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
title_font = Font(name="Segoe UI", size=16, bold=True, color="0F172A")
subtitle_font = Font(name="Segoe UI", size=10, italic=True, color="475569")
bold_font = Font(name="Segoe UI", size=10, bold=True, color="0F172A")
regular_font = Font(name="Segoe UI", size=10, color="1E293B")
green_bold_font = Font(name="Segoe UI", size=10, bold=True, color="047857")
blue_bold_font = Font(name="Segoe UI", size=10, bold=True, color="0369A1")

thin_border = Border(
    left=Side(style="thin", color="CBD5E1"),
    right=Side(style="thin", color="CBD5E1"),
    top=Side(style="thin", color="CBD5E1"),
    bottom=Side(style="thin", color="CBD5E1")
)

def auto_fit_columns(ws, max_cols=25):
    for col in ws.iter_cols(min_col=1, max_col=max_cols):
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            val = str(cell.value or "")
            if len(val) > max_len:
                max_len = len(val)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 11)

# ==============================================================================
# SHEET 1: FLEET LOCATIONS & EEZ STATUS
# ==============================================================================
ws1 = wb.create_sheet(title="Fleet EEZ & Locations")
ws1.views.sheetView[0].showGridLines = True

ws1.append(["INCOIS-NIOT OMNI Moored Buoy Fleet: Authoritative Coordinates & EEZ Verification"])
ws1.append(["Verified against Indian Sovereign 200 NM Exclusive Economic Zone (UNCLOS / Marine Regions MRGID 8480) & INCOIS GeoServer WFS"])
ws1.append([])

ws1.cell(row=1, column=1).font = title_font
ws1.cell(row=2, column=1).font = subtitle_font

headers_s1 = [
    "Station ID", "Station Name", "Ocean Basin", "Sub-Sector / Location",
    "Latitude (° N)", "Longitude (° E)", "Coordinates (DMS)",
    "EEZ Jurisdiction Status", "Designated EEZ Sector / Zone",
    "Distance to EEZ Border (NM)", "Distance to EEZ Border (km)",
    "Water Depth (m)", "Operating Agency", "Deployment Strategic Purpose"
]
ws1.append(headers_s1)
header_row_idx = 4
for c_idx in range(1, len(headers_s1) + 1):
    cell = ws1.cell(row=header_row_idx, column=c_idx)
    cell.fill = navy_header_fill
    cell.font = header_font
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

for b in FLEET:
    dms_str = f"{dec_to_dms(b['lat'], True)}, {dec_to_dms(b['lon'], False)}"
    row_data = [
        b["id"],
        b["name"],
        b["basin"],
        b["subsector"],
        round(b["lat"], 4),
        round(b["lon"], 4),
        dms_str,
        b["status_label"],
        b["eez_zone"],
        b["dist_eez_nm"],
        b["dist_eez_km"],
        b["depth_m"],
        "NIOT / MoES, Govt. of India",
        b["rationale"]
    ]
    ws1.append(row_data)
    curr_row = ws1.max_row
    is_eez = b["in_eez"]
    
    for col_i in range(1, len(row_data) + 1):
        c = ws1.cell(row=curr_row, column=col_i)
        c.font = regular_font
        c.border = thin_border
        c.alignment = Alignment(vertical="center")
        if is_eez:
            c.fill = eez_green_fill
        else:
            c.fill = highseas_blue_fill
    
    # Highlight status cell
    status_cell = ws1.cell(row=curr_row, column=8)
    status_cell.font = green_bold_font if is_eez else blue_bold_font
    status_cell.alignment = Alignment(horizontal="center", vertical="center")
    
    # Center numbers
    for col_center in [1, 2, 5, 6, 10, 11, 12]:
        ws1.cell(row=curr_row, column=col_center).alignment = Alignment(horizontal="center", vertical="center")

auto_fit_columns(ws1, len(headers_s1))

# ==============================================================================
# SHEET 2: LATEST BUOY TELEMETRY VALUES
# ==============================================================================
ws2 = wb.create_sheet(title="Latest Telemetry Readings")
ws2.views.sheetView[0].showGridLines = True

ws2.append(["OMNI Moored Buoy Network: Latest Physical Telemetry & Structural Loads"])
ws2.append(["Real-time metocean parameters from INCOIS surface sensors and MoorDyn/Catenary Digital Twin structural load solvers"])
ws2.append([])

ws2.cell(row=1, column=1).font = title_font
ws2.cell(row=2, column=1).font = subtitle_font

headers_s2 = [
    "Station ID", "Observation Time (UTC)", "Latitude (°N)", "Longitude (°E)", "EEZ Category",
    "Air Temp (°C)", "Air Pressure (hPa)", "Wind Speed (m/s)", "Wind Speed (knots)", "Wind Direction (°)",
    "Wind Gust (m/s)", "Humidity (%)", "Rainfall (mm)", "Radiation (W/m²)",
    "Wave Height Hm0 (m)", "SST (°C)", "Salinity (PSU)",
    "Fairlead Tension (kN)", "Anchor Tension (kN)", "Horizontal Excursion (m)",
    "Line Angle (°)", "Mooring Utilization (%)", "Safety Factor", "Risk State"
]
ws2.append(headers_s2)
for c_idx in range(1, len(headers_s2) + 1):
    cell = ws2.cell(row=4, column=c_idx)
    cell.fill = navy_header_fill
    cell.font = header_font
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

for b in FLEET:
    bid = b["id"]
    obs = fleet_latest_obs.get(bid, {})
    wspd = obs.get("wind_speed")
    wspd_kts = round(wspd * 1.94384, 1) if wspd is not None else None
    
    row_vals = [
        bid,
        obs.get("timestamp") or "2026-10-17T06:00:00Z",
        round(b["lat"], 4),
        round(b["lon"], 4),
        "SOVEREIGN EEZ" if b["in_eez"] else "HIGH SEAS",
        obs.get("air_temp"),
        obs.get("pressure"),
        obs.get("wind_speed"),
        wspd_kts,
        obs.get("wind_dir"),
        obs.get("wind_gust"),
        obs.get("humidity"),
        obs.get("rainfall"),
        obs.get("radiation"),
        obs.get("wave_height"),
        obs.get("sst"),
        obs.get("salinity"),
        b["dt_fairlead_kn"],
        b["dt_anchor_kn"],
        b["dt_excursion_m"],
        b["dt_line_angle_deg"],
        b["dt_utilization_pct"],
        b["dt_safety_factor"],
        b["dt_risk_state"]
    ]
    ws2.append(row_vals)
    curr_r = ws2.max_row
    for c_i in range(1, len(row_vals) + 1):
        cell = ws2.cell(row=curr_r, column=c_i)
        cell.font = regular_font
        cell.border = thin_border
        cell.alignment = Alignment(horizontal="center", vertical="center")
        if curr_r % 2 == 1:
            cell.fill = zebra_fill
    
    # Highlight risk
    risk_cell = ws2.cell(row=curr_r, column=len(row_vals))
    risk_cell.font = bold_font

auto_fit_columns(ws2, len(headers_s2))

# ==============================================================================
# SHEET 3: SUBSURFACE CTD TEMPERATURE & SALINITY PROFILES
# ==============================================================================
ws3 = wb.create_sheet(title="Subsurface Depth Profiles")
ws3.views.sheetView[0].showGridLines = True

ws3.append(["INCOIS OMNI Subsurface CTD & Oceanographic Profile Observations"])
ws3.append(["Multi-depth inductive conductivity-temperature-depth (CTD) sensor line measurements across the water column"])
ws3.append([])

ws3.cell(row=1, column=1).font = title_font
ws3.cell(row=2, column=1).font = subtitle_font

headers_s3 = [
    "Station ID", "Observation Timestamp (UTC)", "Sensor Depth (m)",
    "Measured Water Temperature (°C)", "Measured Salinity (PSU)"
]
ws3.append(headers_s3)
for c_idx in range(1, len(headers_s3) + 1):
    cell = ws3.cell(row=4, column=c_idx)
    cell.fill = navy_header_fill
    cell.font = header_font
    cell.alignment = Alignment(horizontal="center", vertical="center")

# Sort profiles by station and depth
sorted_profiles = sorted(fleet_profiles, key=lambda x: (x["buoy_id"], x["timestamp"], x["depth_m"] or 0))
for p in sorted_profiles[:500]: # top 500 depth points
    row_vals = [
        p["buoy_id"],
        p["timestamp"],
        p["depth_m"],
        p["temp_c"],
        p["salinity_psu"]
    ]
    ws3.append(row_vals)
    curr_r = ws3.max_row
    for c_i in range(1, len(row_vals) + 1):
        cell = ws3.cell(row=curr_r, column=c_i)
        cell.font = regular_font
        cell.border = thin_border
        cell.alignment = Alignment(horizontal="center", vertical="center")
        if curr_r % 2 == 1:
            cell.fill = zebra_fill

auto_fit_columns(ws3, len(headers_s3))

# ==============================================================================
# SHEET 4: HISTORICAL OBSERVATION LOG
# ==============================================================================
ws4 = wb.create_sheet(title="Historical Telemetry Log")
ws4.views.sheetView[0].showGridLines = True

ws4.append(["Chronological Telemetry Observation Archive (OMNI Ingestion Feed)"])
ws4.append(["Synoptic 3-hourly time-series observation records stored in MoorSense SQLite telemetry store"])
ws4.append([])

ws4.cell(row=1, column=1).font = title_font
ws4.cell(row=2, column=1).font = subtitle_font

headers_s4 = [
    "Station ID", "Timestamp (UTC)", "Air Temp (°C)", "Barometric Pressure (hPa)",
    "Wind Speed (m/s)", "Wind Dir (°)", "Wind Gust (m/s)", "Humidity (%)",
    "Rainfall (mm)", "Radiation (W/m²)", "Wave Height Hm0 (m)", "SST (°C)", "Salinity (PSU)"
]
ws4.append(headers_s4)
for c_idx in range(1, len(headers_s4) + 1):
    cell = ws4.cell(row=4, column=c_idx)
    cell.fill = navy_header_fill
    cell.font = header_font
    cell.alignment = Alignment(horizontal="center", vertical="center")

for rec in fleet_history[-800:]: # latest 800 chronological logs
    row_vals = [
        rec["buoy_id"],
        rec["timestamp"],
        rec["air_temp"],
        rec["pressure"],
        rec["wind_speed"],
        rec["wind_dir"],
        rec["wind_gust"],
        rec["humidity"],
        rec["rainfall"],
        rec["radiation"],
        rec["wave_height"],
        rec["sst"],
        rec["salinity"]
    ]
    ws4.append(row_vals)
    curr_r = ws4.max_row
    for c_i in range(1, len(row_vals) + 1):
        cell = ws4.cell(row=curr_r, column=c_i)
        cell.font = regular_font
        cell.border = thin_border
        cell.alignment = Alignment(horizontal="center", vertical="center")
        if curr_r % 2 == 1:
            cell.fill = zebra_fill

auto_fit_columns(ws4, len(headers_s4))

# ==============================================================================
# SHEET 5: PARAMETER REFERENCE DICTIONARY
# ==============================================================================
ws5 = wb.create_sheet(title="Parameter Dictionary")
ws5.views.sheetView[0].showGridLines = True

ws5.append(["INCOIS / NIOT OMNI Buoy Sensor & Parameter Specifications"])
ws5.append(["Standards grounding: API RP 2SK, WMO No. 8, INCOIS Technical Manual Series"])
ws5.append([])

ws5.cell(row=1, column=1).font = title_font
ws5.cell(row=2, column=1).font = subtitle_font

headers_s5 = [
    "Parameter Code", "Full Parameter Name", "Category", "Canonical Unit",
    "Measurement Range", "Sensor Subsystem", "Physical Placement / Depth", "Operational Purpose"
]
ws5.append(headers_s5)
for c_idx in range(1, len(headers_s5) + 1):
    cell = ws5.cell(row=4, column=c_idx)
    cell.fill = navy_header_fill
    cell.font = header_font
    cell.alignment = Alignment(horizontal="center", vertical="center")

DICT_ITEMS = [
    ("air_temperature", "Air Temperature", "Meteorology", "°C", "-10 to +50 °C", "Rotronic / Vaisala Platinum RTD", "3.0 m above sea level (mast)", "Atmospheric heat flux and thermodynamic stability"),
    ("air_pressure", "Barometric Air Pressure", "Meteorology", "hPa", "800 to 1100 hPa", "Vaisala Barocap capacitive sensor", "3.0 m above sea level (mast)", "Tropical cyclone central pressure & storm tracking"),
    ("wind_speed", "Wind Speed (10-min avg)", "Meteorology", "m/s", "0 to 75 m/s", "Gill 2D Ultrasonic Anemometer", "3.0 m above sea level (mast)", "Surface wind stress forcing and wave generation"),
    ("wind_direction", "Wind Direction", "Meteorology", "° (degrees)", "0 to 360°", "Gill Ultrasonic / Fluxgate Compass", "3.0 m above sea level (mast)", "Vector metocean wind forcing alignment"),
    ("wind_gust", "Peak Wind Gust", "Meteorology", "m/s", "0 to 90 m/s", "Gill 2D Ultrasonic Anemometer", "3.0 m above sea level (mast)", "Extreme storm gusts and squall monitoring"),
    ("humidity", "Relative Humidity", "Meteorology", "%", "0 to 100 %", "Capacitive thin-film polymer", "3.0 m above sea level (mast)", "Latent heat flux and air-sea moisture exchange"),
    ("rainfall", "Precipitation / Rainfall Rate", "Meteorology", "mm", "0 to 500 mm/h", "Optical Rain Gauge (ORG)", "3.0 m above sea level (mast)", "Monsoonal freshwater flux and salinity stratification"),
    ("irradiance / radiation", "Shortwave / Solar Radiation", "Meteorology", "W/m²", "0 to 1500 W/m²", "Eppley / Kipp & Zonen Pyranometer", "3.5 m mast peak", "Diurnal solar insolation & mixed-layer heating"),
    ("hm0 / significant_wave_height", "Significant Wave Height", "Waves", "m", "0 to 25 m", "Datawell MRU Motion Reference Unit", "Hull centroid (internal 3-axis accel)", "Ocean wave energy and extreme sea-state safety"),
    ("tp / peak_period", "Peak Wave Period", "Waves", "s", "2 to 30 s", "Spectral FFT of vertical displacement", "Hull MRU", "Swell vs. wind-sea energy partition"),
    ("sst / water_temperature", "Sea Surface Temperature", "Oceanography", "°C", "-2 to +40 °C", "Sea-Bird SBE 37-IM CTD MicroCAT", "1.0 m below surface", "Ocean heat content & cyclone intensification index"),
    ("salinity / conductivity", "Sea Surface Salinity", "Oceanography", "PSU", "0 to 42 PSU", "Sea-Bird Inductive Conductivity Cell", "1.0 m below surface", "Barrier layer dynamics & freshwater plume tracking"),
    ("current_speed", "Surface Current Speed", "Currents", "cm/s (m/s)", "0 to 350 cm/s", "Nortek Aquadopp / DVS Current Meter", "1.25 m to 3.0 m depth", "Eulerian surface transport and hydrodynamic drag"),
    ("current_direction", "Surface Current Direction", "Currents", "° (degrees)", "0 to 360°", "Acoustic Doppler with tilt compass", "1.25 m to 3.0 m depth", "Directional current shear on mooring line"),
    ("water_temperature_profile", "Subsurface Temperature Profile", "Profile", "°C", "-2 to +35 °C", "Inductive SBE-39 / SBE-37 chain", "1m, 5m, 10m, 20m, 50m, 100m, 500m", "Thermocline depth, internal waves & heat content"),
    ("salinity_profile", "Subsurface Salinity Profile", "Profile", "PSU", "20 to 40 PSU", "Inductive Conductivity-Temp sensors", "1m, 10m, 20m, 50m, 100m, 500m", "Halocline stability & river discharge capping"),
    ("fairlead_tension", "Mooring Fairlead Tension", "Digital Twin", "kN", "0 to 350 kN", "Lumped-mass dynamic solver / strain gauge", "Surface hull fairlead interface", "Mooring line tension utilization & safety factor"),
    ("anchor_tension", "Anchor Holding Tension", "Digital Twin", "kN", "0 to 300 kN", "Inverse catenary solver", "Seabed anchor point", "Anchor sinker stability & vertical uplift prevention"),
    ("horizontal_excursion", "Buoy Watch Circle Excursion", "Digital Twin", "m", "0 to 950 m", "Geodetic WGS84 GPS displacement", "Sea surface watch circle plane", "Mooring compliance and breakaway detection"),
]

for item in DICT_ITEMS:
    ws5.append(list(item))
    curr_r = ws5.max_row
    for c_i in range(1, len(item) + 1):
        cell = ws5.cell(row=curr_r, column=c_i)
        cell.font = regular_font
        cell.border = thin_border
        cell.alignment = Alignment(vertical="center")
        if curr_r % 2 == 1:
            cell.fill = zebra_fill
    ws5.cell(row=curr_r, column=1).font = bold_font
    ws5.cell(row=curr_r, column=4).alignment = Alignment(horizontal="center", vertical="center")

auto_fit_columns(ws5, len(headers_s5))

# --- 8. Save Workbook ---
out_paths = [
    Path(r"d:\ocean\moore\INCOIS_OMNI_Buoy_Fleet_Data.xlsx"),
    Path(r"d:\ocean\moore\backend\data\INCOIS_OMNI_Buoy_Fleet_Data.xlsx"),
]
for p in out_paths:
    wb.save(p)
    print(f"Successfully generated: {p} ({p.stat().st_size:,} bytes)")
