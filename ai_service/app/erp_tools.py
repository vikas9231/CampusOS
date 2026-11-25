"""Fixed, read-only CampusOS ERP tools exposed to Gemini.

All query clients carry the authenticated user's Supabase JWT. Tools accept no
model-supplied identifiers, so the database RLS policy remains the scope guard.
"""
from __future__ import annotations

from typing import Any

from google.genai import types
from supabase import Client

PAGE_SIZE = 100
MAX_SCAN_ROWS = 10_000
ROSTER_LIMIT = 50
_UNSET = object()

ROLE_TOOLS: dict[str, tuple[str, ...]] = {
    "student": ("get_my_profile", "get_my_attendance", "get_my_courses", "get_my_timetable", "get_my_fee_status", "get_my_results"),
    "faculty": ("get_my_profile", "get_my_courses", "get_my_students", "get_class_attendance", "get_my_timetable"),
    "hod": ("get_my_profile", "get_department_students", "get_department_faculty", "get_department_attendance", "get_department_statistics"),
    "super_admin": ("get_my_profile", "get_total_students", "get_total_faculty", "get_total_courses", "get_pending_registrations", "get_college_statistics"),
}

TOOL_DESCRIPTIONS = {
    "search_college_documents": "Search authorized college knowledge documents. Use for policies and combine with ERP tools when both are asked.",
    "get_my_profile": "Read the signed-in user's own profile and own student/faculty/department summary.",
    "get_my_attendance": "Get only the signed-in student's attendance totals and percentage.",
    "get_my_courses": "Get the signed-in student's enrolled courses or signed-in faculty member's assigned offerings.",
    "get_my_timetable": "Get the signed-in user's timetable, limited to their own courses or assigned offerings.",
    "get_my_fee_status": "Get invoices, recorded payments, and outstanding balances for the signed-in student only.",
    "get_my_results": "Get published examination results for the signed-in student only.",
    "get_my_students": "Get a bounded roster from the signed-in faculty member's assigned offerings only.",
    "get_class_attendance": "Get attendance summaries for students in the signed-in faculty member's assigned offerings only.",
    "get_department_students": "Get bounded student records in the signed-in HOD's department only.",
    "get_department_faculty": "Get faculty summaries from the signed-in HOD's department only.",
    "get_department_attendance": "Get aggregate attendance for the signed-in HOD's department only.",
    "get_department_statistics": "Get student, faculty, course, and attendance statistics for the signed-in HOD's department only.",
    "get_total_students": "Count college student records as Super Admin.",
    "get_total_faculty": "Count college faculty by status as Super Admin.",
    "get_total_courses": "Count college courses as Super Admin.",
    "get_pending_registrations": "Count pending student and faculty registration requests as Super Admin.",
    "get_college_statistics": "Get college-wide student, faculty, course, and pending request counts as Super Admin.",
}


def available_tools(role: str) -> tuple[str, ...]:
    if role not in ROLE_TOOLS:
        raise PermissionError("Unsupported assistant role")
    return ("search_college_documents", *ROLE_TOOLS[role])


def gemini_tool(role: str) -> types.Tool:
    return types.Tool(function_declarations=[
        types.FunctionDeclaration(
            name=name,
            description=TOOL_DESCRIPTIONS[name],
            parameters_json_schema={"type": "object", "properties": {}, "additionalProperties": False},
        )
        for name in available_tools(role)
    ])


def _rows(db: Client, table: str, columns: str, limit: int = 100, **filters: str) -> list[dict[str, Any]]:
    query = db.table(table).select(columns)
    for key, value in filters.items():
        query = query.eq(key, value)
    return query.limit(limit).execute().data or []


def _paged_rows(db: Client, table: str, columns: str, **filters: str) -> tuple[list[dict[str, Any]], int, bool]:
    """Read a bounded, deterministic scan; report when the safety ceiling truncates it."""
    total = _count(db, table, **filters)
    rows: list[dict[str, Any]] = []
    for start in range(0, min(total, MAX_SCAN_ROWS), PAGE_SIZE):
        query = db.table(table).select(columns)
        for key, value in filters.items():
            query = query.eq(key, value)
        page = query.order("id").range(start, min(start + PAGE_SIZE - 1, MAX_SCAN_ROWS - 1)).execute().data or []
        rows.extend(page)
        if len(page) < min(PAGE_SIZE, total - start):
            break
    return rows, total, total > len(rows)


def _count(db: Client, table: str, **filters: str) -> int:
    query = db.table(table).select("id", count="exact")
    for key, value in filters.items():
        query = query.eq(key, value)
    return int(query.execute().count or 0)


def _result_meta(returned_count: int, total_count: int | None, is_partial: bool | None = None) -> dict[str, Any]:
    return {
        "is_partial": (returned_count < total_count) if is_partial is None and total_count is not None else (True if is_partial is None else is_partial),
        "returned_count": returned_count,
        "total_count": total_count,
    }


def _with_meta(data: dict[str, Any], returned_count: int = 1, total_count: Any = _UNSET,
               is_partial: bool | None = None) -> dict[str, Any]:
    total = returned_count if total_count is _UNSET else total_count
    return {**data, "result_meta": _result_meta(returned_count, total, is_partial)}


def _attendance_counts(db: Client, enrollment_ids: list[str]) -> dict[str, int]:
    counts = {status: 0 for status in ("present", "absent", "excused")}
    for enrollment_id in enrollment_ids:
        for status in counts:
            query = db.table("attendance_records").select("id", count="exact").eq("enrollment_id", enrollment_id).eq("status", status)
            counts[status] += int(query.execute().count or 0)
    return counts


def _student(db: Client, user_id: str) -> dict[str, Any] | None:
    data = _rows(db, "students", "id,profile_id,course_id,admission_year,status", profile_id=user_id)
    return data[0] if data else None


def _faculty(db: Client, user_id: str) -> dict[str, Any] | None:
    data = _rows(db, "faculty", "id,profile_id,department_id,status", profile_id=user_id)
    return data[0] if data else None


def _offering_info(db: Client, offering: dict[str, Any]) -> dict[str, Any]:
    subjects = _rows(db, "subjects", "id,course_id,code,title,semester_number", id=offering["subject_id"])
    if not subjects:
        return {"section": offering.get("section"), "status": offering.get("status")}
    subject = subjects[0]
    courses = _rows(db, "courses", "code,name", id=subject["course_id"])
    return {"offering_id": offering["id"], "course": courses[0]["name"] if courses else None,
            "course_code": courses[0]["code"] if courses else None, "subject": subject["title"],
            "subject_code": subject["code"], "semester": subject["semester_number"],
            "section": offering.get("section"), "status": offering.get("status")}


def _student_enrollments(db: Client, student_id: str) -> list[dict[str, Any]]:
    return _paged_rows(db, "enrollments", "id,course_offering_id,status", student_id=student_id)[0]


def _student_offerings(db: Client, student_id: str) -> tuple[list[dict[str, Any]], int, bool]:
    result = []
    enrollments, total_enrollments, partial = _paged_rows(
        db, "enrollments", "id,course_offering_id,status", student_id=student_id)
    for enrollment in enrollments:
        if enrollment["status"] != "enrolled":
            continue
        offering = _rows(db, "course_offerings", "id,subject_id,section,status", id=enrollment["course_offering_id"])
        if offering:
            result.append(_offering_info(db, offering[0]))
    return result, len(result), partial


def _faculty_offerings(db: Client, faculty_id: str) -> tuple[list[dict[str, Any]], bool]:
    rows, _, partial = _paged_rows(db, "course_offerings", "id,subject_id,section,status", faculty_id=faculty_id)
    return [_offering_info(db, row) for row in rows], partial


def _attendance_for_enrollments(db: Client, enrollments: list[dict[str, Any]]) -> dict[str, Any]:
    counts = _attendance_counts(db, [row["id"] for row in enrollments])
    present, absent, excused = counts["present"], counts["absent"], counts["excused"]
    denominator = present + absent
    return {"sessions_recorded": present + absent + excused, "present": present, "absent": absent, "excused": excused,
            "percentage": round(100 * present / denominator, 1) if denominator else None}


def _timetable(db: Client, offerings: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    day_names = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday"}
    output = []
    partial = False
    for offering in offerings:
        offering_id = offering.get("offering_id") or offering.get("id")
        slots, _total_slots, slots_partial = _paged_rows(
            db, "timetable_slots", "id,course_offering_id,weekday,starts_at,ends_at,room_id", course_offering_id=offering_id)
        partial = partial or slots_partial
        for slot in slots:
            rooms = _rows(db, "rooms", "building,room_number", id=slot["room_id"])
            room = rooms[0] if rooms else {}
            output.append({"day": day_names.get(slot["weekday"], "Unknown"), "starts_at": slot["starts_at"],
                           "ends_at": slot["ends_at"], "room": " ".join(x for x in (room.get("building"), room.get("room_number")) if x),
                           "course": offering.get("course"), "subject": offering.get("subject"), "section": offering.get("section")})
    return sorted(output, key=lambda row: (list(day_names.values()).index(row["day"]) if row["day"] in day_names.values() else 7, row["starts_at"])), partial


def _student_attendance(db: Client, student: dict[str, Any]) -> dict[str, Any]:
    return _attendance_for_enrollments(db, [row for row in _student_enrollments(db, student["id"]) if row["status"] == "enrolled"])


def _student_results(db: Client, student: dict[str, Any]) -> tuple[list[dict[str, Any]], int, bool]:
    output = []
    total_count = 0
    partial = False
    enrollments, _total_enrollments, enrollment_partial = _paged_rows(
        db, "enrollments", "id,course_offering_id,status", student_id=student["id"])
    partial = enrollment_partial
    for enrollment in enrollments:
        if enrollment["status"] != "enrolled":
            continue
        marks, _total_marks, marks_partial = _paged_rows(db, "marks", "id,exam_subject_id,score,status", enrollment_id=enrollment["id"])
        partial = partial or marks_partial
        for mark in marks:
            if mark["status"] != "published":
                continue
            total_count += 1
            exam_subject = _rows(db, "exam_subjects", "examination_id,exam_date,max_marks", id=mark["exam_subject_id"])
            if not exam_subject:
                continue
            exam = _rows(db, "examinations", "title,exam_type,status", id=exam_subject[0]["examination_id"])
            if exam:
                output.append({"exam": exam[0]["title"], "exam_type": exam[0]["exam_type"], "date": exam_subject[0]["exam_date"],
                               "score": mark["score"], "maximum_marks": exam_subject[0]["max_marks"]})
    return output[:ROSTER_LIMIT], total_count, partial or total_count > ROSTER_LIMIT


def _faculty_students(db: Client, faculty: dict[str, Any], with_attendance: bool) -> tuple[list[dict[str, Any]], int, bool]:
    output = []
    total_count = 0
    offerings, _total_offerings, partial = _paged_rows(db, "course_offerings", "id,subject_id,section,status", faculty_id=faculty["id"])
    for offering in offerings:
        course = _offering_info(db, offering)
        enrollments, _total_enrollments, enrollments_partial = _paged_rows(db, "enrollments", "id,student_id,status", course_offering_id=offering["id"])
        partial = partial or enrollments_partial
        for enrollment in enrollments:
            if enrollment["status"] != "enrolled":
                continue
            total_count += 1
            if len(output) >= ROSTER_LIMIT:
                partial = True
                continue
            students = _rows(db, "students", "id,profile_id,status", id=enrollment["student_id"])
            if not students:
                continue
            profiles = _rows(db, "profiles", "full_name", id=students[0]["profile_id"])
            item: dict[str, Any] = {"student": profiles[0]["full_name"] if profiles else "Student",
                                    "course": course.get("course"), "subject": course.get("subject"),
                                    "section": course.get("section"), "status": students[0]["status"]}
            if with_attendance:
                item.update(_attendance_for_enrollments(db, [enrollment]))
            output.append(item)
    return output, total_count, partial


def _hod_departments(db: Client, user_id: str) -> tuple[list[str], bool]:
    # Role assignments are read with the authenticated user's JWT. The user_id
    # filter is fixed from the verified Supabase session, never from Gemini.
    rows, _total, partial = _paged_rows(db, "role_assignments", "id,department_id", user_id=user_id, role="hod")
    return list(dict.fromkeys(row["department_id"] for row in rows if row.get("department_id"))), partial


def _department_courses(db: Client, department_id: str) -> list[dict[str, Any]]:
    return _rows(db, "courses", "id,name,code", department_id=department_id)


def _assigned_courses(db: Client, department_ids: list[str]) -> tuple[list[dict[str, Any]], int, bool]:
    courses: list[dict[str, Any]] = []
    total_count = 0
    partial = False
    for department_id in department_ids:
        department_courses, count, was_partial = _paged_rows(db, "courses", "id,name,code", department_id=department_id)
        courses.extend(department_courses)
        total_count += count
        partial = partial or was_partial
    return courses, total_count, partial


def _department_attendance(db: Client, department_ids: list[str]) -> tuple[dict[str, Any], bool]:
    total_present = total_absent = total_excused = 0
    by_course = []
    partial = False
    course_rows = []
    for department_id in department_ids:
        department_courses, _count_courses, courses_partial = _paged_rows(db, "courses", "id,name,code", department_id=department_id)
        course_rows.extend(department_courses)
        partial = partial or courses_partial
    for course in course_rows:
        enrollment_ids = []
        subjects, _count_subjects, p1 = _paged_rows(db, "subjects", "id", course_id=course["id"])
        partial = partial or p1
        for subject in subjects:
            offerings, _count_offerings, p2 = _paged_rows(db, "course_offerings", "id", subject_id=subject["id"])
            partial = partial or p2
            for offering in offerings:
                enrollments, _count_enrollments, p3 = _paged_rows(db, "enrollments", "id,status", course_offering_id=offering["id"])
                partial = partial or p3
                for enrollment in enrollments:
                    if enrollment["status"] == "enrolled":
                        enrollment_ids.append(enrollment["id"])
        counts = _attendance_counts(db, enrollment_ids)
        present, absent, excused = counts["present"], counts["absent"], counts["excused"]
        denom = present + absent
        if len(by_course) < ROSTER_LIMIT:
            by_course.append({"course": course["name"], "present": present, "absent": absent, "excused": excused,
                              "percentage": round(100 * present / denom, 1) if denom else None})
        total_present += present; total_absent += absent; total_excused += excused
    denom = total_present + total_absent
    course_count = sum(_count(db, "courses", department_id=department_id) for department_id in department_ids)
    partial = partial or course_count > len(by_course)
    return {"present": total_present, "absent": total_absent, "excused": total_excused,
            "percentage": round(100 * total_present / denom, 1) if denom else None, "by_course": by_course}, partial


def _college_statistics(db: Client) -> dict[str, Any]:
    return {"students": _count(db, "students"), "faculty": _count(db, "faculty"), "courses": _count(db, "courses"),
            "faculty_statuses": {status: _count(db, "faculty", status=status) for status in ("active", "on_leave", "inactive")},
            "pending_student_registrations": _count(db, "role_requests", status="pending", requested_role="student"),
            "pending_faculty_registrations": _count(db, "role_requests", status="pending", requested_role="faculty")}


def execute_erp_tool(name: str, args: dict[str, Any], role: str, user_id: str, db: Client) -> dict[str, Any]:
    """Execute only role-allowlisted tools; `db` must be bound to this user's JWT."""
    if name not in available_tools(role):
        raise PermissionError("Tool is not authorized for this role")
    if args:
        raise ValueError("ERP tools do not accept caller-provided identifiers or filters")
    if name == "search_college_documents":
        raise ValueError("Document search is handled separately")
    if name == "get_my_profile":
        own = _rows(db, "profiles", "full_name", id=user_id)
        profile: dict[str, Any] = {"name": own[0]["full_name"] if own else None}
        if role == "student":
            row = _student(db, user_id)
            profile["student"] = {"admission_year": row["admission_year"], "status": row["status"]} if row else None
        elif role == "faculty":
            row = _faculty(db, user_id)
            profile["faculty"] = {"status": row["status"]} if row else None
        elif role == "hod":
            department_ids, partial = _hod_departments(db, user_id)
            profile["departments"] = [department[0] for department_id in department_ids
                                      if (department := _rows(db, "departments", "name,code", id=department_id))]
            profile["result_meta"] = _result_meta(len(profile["departments"]), len(department_ids), partial)
        return _with_meta(profile)
    if name == "get_college_statistics":
        return _with_meta(_college_statistics(db))
    if name == "get_total_students":
        return _with_meta({"students": _count(db, "students")})
    if name == "get_total_courses":
        return _with_meta({"courses": _count(db, "courses")})
    if name == "get_total_faculty":
        return _with_meta({"faculty": _count(db, "faculty"), "statuses": {status: _count(db, "faculty", status=status) for status in ("active", "on_leave", "inactive")}})
    if name == "get_pending_registrations":
        return _with_meta({"pending_student_registrations": _count(db, "role_requests", status="pending", requested_role="student"),
                           "pending_faculty_registrations": _count(db, "role_requests", status="pending", requested_role="faculty")})
    if role == "student":
        student = _student(db, user_id)
        if not student:
            return {"available": False, "reason": "No student record is assigned to this account."}
        if name == "get_my_attendance":
            enrollments, total_enrollments, enrollment_partial = _paged_rows(
                db, "enrollments", "id,course_offering_id,status", student_id=student["id"])
            attendance = _attendance_for_enrollments(db, [row for row in enrollments if row["status"] == "enrolled"])
            return _with_meta(attendance, 1, 1, is_partial=enrollment_partial)
        if name == "get_my_courses":
            rows, total, partial = _student_offerings(db, student["id"])
            return _with_meta({"courses": rows[:ROSTER_LIMIT]}, min(len(rows), ROSTER_LIMIT),
                              None if partial else total, is_partial=partial or len(rows) > ROSTER_LIMIT)
        if name == "get_my_timetable":
            offerings, _total_offerings, offerings_partial = _student_offerings(db, student["id"])
            rows, nested_partial = _timetable(db, offerings)
            partial = offerings_partial or nested_partial or len(rows) > ROSTER_LIMIT
            return _with_meta({"timetable": rows[:ROSTER_LIMIT]}, min(len(rows), ROSTER_LIMIT),
                              None if partial else len(rows), is_partial=partial)
        if name == "get_my_results":
            rows, total, partial = _student_results(db, student)
            return _with_meta({"published_results": rows}, len(rows), None if partial else total, is_partial=partial)
        if name == "get_my_fee_status":
            invoices, total_invoices, invoice_partial = _paged_rows(
                db, "student_invoices", "id,invoice_number,total_amount,currency,due_on,status", student_id=student["id"])
            invoices = invoices[:ROSTER_LIMIT]
            result = []
            payments_partial = False
            for invoice in invoices:
                payments, _payment_count, payment_partial = _paged_rows(db, "payments", "amount,status", invoice_id=invoice["id"])
                payments_partial = payments_partial or payment_partial
                paid = sum(float(item["amount"]) for item in payments if item["status"] == "paid")
                amount = float(invoice["total_amount"])
                result.append({"invoice": invoice["invoice_number"], "total": amount, "currency": invoice["currency"],
                               "due_on": invoice["due_on"], "status": invoice["status"], "paid": paid, "balance": max(0, amount - paid)})
            partial = invoice_partial or total_invoices > len(result) or payments_partial
            return _with_meta({"invoices": result}, len(result), total_invoices, is_partial=partial)
    if role == "faculty":
        faculty = _faculty(db, user_id)
        if not faculty:
            return {"available": False, "reason": "No faculty record is assigned to this account."}
        if name == "get_my_courses":
            rows, partial = _faculty_offerings(db, faculty["id"])
            total = _count(db, "course_offerings", faculty_id=faculty["id"])
            return _with_meta({"assigned_courses": rows[:ROSTER_LIMIT]}, min(len(rows), ROSTER_LIMIT), total,
                              is_partial=partial or len(rows) > ROSTER_LIMIT)
        if name == "get_my_timetable":
            offerings, offerings_partial = _faculty_offerings(db, faculty["id"])
            rows, nested_partial = _timetable(db, offerings)
            partial = offerings_partial or nested_partial or len(rows) > ROSTER_LIMIT
            return _with_meta({"timetable": rows[:ROSTER_LIMIT]}, min(len(rows), ROSTER_LIMIT),
                              None if partial else len(rows), is_partial=partial)
        if name == "get_my_students":
            rows, total, partial = _faculty_students(db, faculty, False)
            return _with_meta({"students": rows}, len(rows), total, is_partial=partial or total > len(rows))
        if name == "get_class_attendance":
            rows, total, partial = _faculty_students(db, faculty, True)
            return _with_meta({"class_attendance": rows}, len(rows), total, is_partial=partial or total > len(rows))
    if role == "hod":
        department_ids, assignment_scan_partial = _hod_departments(db, user_id)
        if not department_ids:
            return {"available": False, "reason": "No department is assigned to this HOD account."}
        if name == "get_department_students":
            roster = []
            total_count = 0
            for department_id in department_ids:
                courses, _course_total, courses_partial = _paged_rows(db, "courses", "id,name,code", department_id=department_id)
                assignment_scan_partial = assignment_scan_partial or courses_partial
                for course in courses:
                    total_count += _count(db, "students", course_id=course["id"])
                    remaining = max(0, 50 - len(roster))
                    if not remaining:
                        continue
                    students = _rows(db, "students", "enrollment_number,admission_year,status", limit=remaining, course_id=course["id"])
                    for row in students:
                        roster.append({**row, "course": course["name"], "course_code": course["code"]})
            return _with_meta({"students": roster}, len(roster), None if assignment_scan_partial else total_count,
                              is_partial=assignment_scan_partial or total_count > len(roster))
        if name == "get_department_faculty":
            faculty = []
            total_count = sum(_count(db, "faculty", department_id=department_id) for department_id in department_ids)
            for department_id in department_ids:
                remaining = max(0, 50 - len(faculty))
                if not remaining:
                    continue
                for row in _rows(db, "faculty", "profile_id,status", limit=remaining, department_id=department_id):
                    profiles = _rows(db, "profiles", "full_name", id=row["profile_id"])
                    faculty.append({"name": profiles[0]["full_name"] if profiles else "Faculty", "status": row["status"]})
            return _with_meta({"faculty": faculty}, len(faculty), total_count,
                              is_partial=assignment_scan_partial or len(faculty) < total_count)
        if name == "get_department_attendance":
            _course_rows, total_courses, courses_partial = _assigned_courses(db, department_ids)
            attendance, nested_partial = _department_attendance(db, department_ids)
            is_partial = assignment_scan_partial or courses_partial or nested_partial
            return {"attendance": attendance, "result_meta": {"is_partial": is_partial,
                    "returned_count": len(attendance["by_course"]), "total_count": total_courses}}
        if name == "get_department_statistics":
            courses, total_courses, courses_partial = _assigned_courses(db, department_ids)
            total_students = sum(_count(db, "students", course_id=row["id"]) for row in courses)
            total_faculty = sum(_count(db, "faculty", department_id=department_id) for department_id in department_ids)
            attendance, nested_partial = _department_attendance(db, department_ids)
            return _with_meta({"courses": total_courses, "students": total_students,
                               "faculty": total_faculty, "attendance": attendance},
                              1, 1, is_partial=assignment_scan_partial or courses_partial or nested_partial)
    raise ValueError("Tool is not implemented for this role")
