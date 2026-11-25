import unittest

from app.erp_tools import available_tools, execute_erp_tool, gemini_tool


class Result:
    def __init__(self, data, count=None):
        self.data, self.count = data, count


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, {}
        self.count_mode, self.max_rows = False, None
        self.row_range = None

    def select(self, _columns, count=None):
        self.count_mode = count == "exact"
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def limit(self, value):
        self.max_rows = value
        return self

    def order(self, _column):
        return self

    def range(self, start, end):
        self.row_range = (start, end)
        return self

    def execute(self):
        self.db.queries.append((self.table, dict(self.filters), self.count_mode))
        data = [row for row in self.db.data.get(self.table, [])
                if all(row.get(key) == value for key, value in self.filters.items())]
        total = len(data)
        if self.row_range is not None:
            start, end = self.row_range
            data = data[start:end + 1]
        if self.max_rows is not None:
            data = data[:self.max_rows]
        return Result(data, total if self.count_mode else None)


class DB:
    def __init__(self, data):
        self.data, self.queries = data, []

    def table(self, name):
        return Query(self, name)


class ToolIsolationTests(unittest.TestCase):
    def test_student_attendance_is_filtered_to_own_profile(self):
        db = DB({
            "students": [{"id": "s1", "profile_id": "u1", "status": "active", "course_id": "c1", "admission_year": 2025},
                        {"id": "s2", "profile_id": "u2", "status": "active", "course_id": "c2", "admission_year": 2025}],
            "enrollments": [{"id": "e1", "student_id": "s1", "status": "enrolled"}],
            "attendance_records": [{"enrollment_id": "e1", "status": "present"},
                                    {"enrollment_id": "e1", "status": "absent"},
                                    {"enrollment_id": "e1", "status": "excused"}],
        })
        result = execute_erp_tool("get_my_attendance", {}, "student", "u1", db)
        self.assertEqual(result["percentage"], 50.0)
        self.assertEqual([q[1] for q in db.queries if q[0] == "students"], [{"profile_id": "u1"}])
        with self.assertRaises(PermissionError):
            execute_erp_tool("get_total_students", {}, "student", "u1", db)

    def test_faculty_roster_queries_only_assigned_offerings(self):
        db = DB({
            "faculty": [{"id": "f1", "profile_id": "u-fac", "department_id": "d1", "status": "active"}],
            "course_offerings": [{"id": "o1", "faculty_id": "f1", "subject_id": "sub1", "section": "A", "status": "active"},
                                 {"id": "o2", "faculty_id": "f2", "subject_id": "sub2", "section": "B", "status": "active"}],
            "subjects": [{"id": "sub1", "course_id": "c1", "code": "M", "title": "Math", "semester_number": 1}],
            "courses": [{"id": "c1", "name": "Computing", "code": "CS"}],
            "enrollments": [{"id": "e1", "course_offering_id": "o1", "student_id": "s1", "status": "enrolled"}],
            "students": [{"id": "s1", "profile_id": "u-student", "status": "active"}],
            "profiles": [{"id": "u-student", "full_name": "Learner"}],
            "attendance_records": [{"enrollment_id": "e1", "status": "present"}],
        })
        result = execute_erp_tool("get_class_attendance", {}, "faculty", "u-fac", db)
        self.assertEqual(result["class_attendance"][0]["student"], "Learner")
        offering_filters = [q[1] for q in db.queries if q[0] == "course_offerings"]
        self.assertIn({"faculty_id": "f1"}, offering_filters)
        self.assertNotIn({"faculty_id": "f2"}, offering_filters)
        with self.assertRaises(PermissionError):
            execute_erp_tool("get_department_students", {}, "faculty", "u-fac", db)

    def test_hod_statistics_are_scoped_to_assigned_department(self):
        db = DB({
            "role_assignments": [{"user_id": "u-hod", "role": "hod", "department_id": "d1"}],
            "courses": [{"id": "c1", "department_id": "d1", "name": "Computing", "code": "CS"},
                        {"id": "c2", "department_id": "d2", "name": "Physics", "code": "PH"}],
            "students": [{"id": "s1", "course_id": "c1"}, {"id": "s2", "course_id": "c2"}],
            "faculty": [{"id": "f1", "department_id": "d1"}, {"id": "f2", "department_id": "d2"}],
        })
        result = execute_erp_tool("get_department_statistics", {}, "hod", "u-hod", db)
        self.assertEqual((result["courses"], result["students"], result["faculty"]), (1, 1, 1))
        self.assertFalse(result["result_meta"]["is_partial"])
        filters = [q[1] for q in db.queries if q[0] == "courses"]
        self.assertTrue(filters and all(item.get("department_id") == "d1" for item in filters))
        with self.assertRaises(PermissionError):
            execute_erp_tool("get_total_students", {}, "hod", "u-hod", db)

    def test_hod_multiple_departments_include_assigned_only(self):
        db = DB({
            "role_assignments": [
                {"id": "ra1", "user_id": "u-hod", "role": "hod", "department_id": "d1"},
                {"id": "ra2", "user_id": "u-hod", "role": "hod", "department_id": "d2"},
                {"id": "ra3", "user_id": "u-other", "role": "hod", "department_id": "d3"},
            ],
            "courses": [
                {"id": "c1", "department_id": "d1", "name": "Computing", "code": "CS"},
                {"id": "c2", "department_id": "d2", "name": "Physics", "code": "PH"},
                {"id": "c3", "department_id": "d3", "name": "Chemistry", "code": "CH"},
            ],
            "students": [{"id": "s1", "course_id": "c1"}, {"id": "s2", "course_id": "c2"},
                         {"id": "s3", "course_id": "c3"}],
            "faculty": [{"id": "f1", "department_id": "d1"}, {"id": "f2", "department_id": "d2"},
                        {"id": "f3", "department_id": "d3"}],
        })
        result = execute_erp_tool("get_department_statistics", {}, "hod", "u-hod", db)
        self.assertEqual((result["courses"], result["students"], result["faculty"]), (2, 2, 2))
        queried_departments = {filters.get("department_id") for table, filters, _ in db.queries if table == "courses"}
        self.assertTrue(queried_departments.issubset({"d1", "d2"}))
        assignments = [filters for table, filters, _ in db.queries if table == "role_assignments"]
        self.assertTrue(assignments and all(f["user_id"] == "u-hod" for f in assignments))

    def test_hod_roster_is_capped_and_reports_partial_result(self):
        records = [{"id": f"s{i}", "course_id": "c1", "enrollment_number": f"E{i}",
                    "admission_year": 2025, "status": "active"} for i in range(55)]
        db = DB({
            "role_assignments": [{"id": "ra1", "user_id": "u-hod", "role": "hod", "department_id": "d1"}],
            "courses": [{"id": "c1", "department_id": "d1", "name": "Computing", "code": "CS"}],
            "students": records,
        })
        result = execute_erp_tool("get_department_students", {}, "hod", "u-hod", db)
        self.assertEqual(len(result["students"]), 50)
        self.assertEqual(result["result_meta"], {"is_partial": True, "returned_count": 50, "total_count": 55})
        student_queries = [q for q in db.queries if q[0] == "students" and not q[2]]
        self.assertEqual(student_queries[0][1], {"course_id": "c1"})

    def test_super_admin_receives_aggregates_only_and_tools_are_role_specific(self):
        db = DB({"students": [{"id": "s1", "profile_id": "private1"}, {"id": "s2", "profile_id": "private2"}],
                 "faculty": [{"id": "f1", "status": "active"}], "courses": [{"id": "c1"}],
                 "role_requests": [{"id": "r1", "status": "pending", "requested_role": "student"}]})
        result = execute_erp_tool("get_college_statistics", {}, "super_admin", "u-admin", db)
        self.assertEqual(result["students"], 2)
        self.assertEqual(result["pending_student_registrations"], 1)
        self.assertNotIn("student_records", result)
        self.assertTrue(all(query[2] for query in db.queries))
        self.assertNotIn("get_total_students", available_tools("student"))
        self.assertNotIn("get_department_students", available_tools("faculty"))
        self.assertNotIn("get_total_faculty", available_tools("hod"))
        self.assertNotIn("get_my_results", available_tools("super_admin"))
        self.assertEqual({d.name for d in gemini_tool("student").function_declarations}, set(available_tools("student")))

    def test_model_arguments_and_unauthorized_roles_are_rejected(self):
        db = DB({})
        with self.assertRaises(ValueError):
            execute_erp_tool("get_my_courses", {"student_id": "someone-else"}, "student", "u1", db)
        with self.assertRaises(PermissionError):
            available_tools("unknown")
        self.assertEqual(db.queries, [])


if __name__ == "__main__":
    unittest.main()
