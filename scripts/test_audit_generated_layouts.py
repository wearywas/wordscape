"""Optional development checks: python -m unittest discover -s scripts -p test_audit_generated_layouts.py"""
import unittest
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("layout_audit", Path(__file__).with_name("audit-generated-layouts.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
measure_pair, polygon = audit.measure_pair, audit.polygon


def obj(oid, x, y, width=10, depth=10, rotation=0):
    return {"id": oid, "label": oid, "kind": "building", "x": x, "y": y,
            "width": width, "depth": depth, "rotation": rotation, "height": 5}


class PolygonAuditTests(unittest.TestCase):
    def measure(self, a, b):
        return measure_pair(a, b, {a["id"]: polygon(a), b["id"]: polygon(b)})

    def test_local_footprint_rotates_before_translation(self):
        building = obj("rotated", 20, 30, rotation=90)
        building["footprint"] = [[-1, -2], [1, -2], [1, 2], [-1, 2]]
        transformed = polygon(building)
        for actual, expected in zip(transformed.bounds, [18, 29, 22, 31]):
            self.assertAlmostEqual(actual, expected)
        self.assertAlmostEqual(transformed.area, 8)

    def test_shared_wall_is_separate_from_positive_area_overlap(self):
        a = obj("a", 20, 20)
        touching = self.measure(a, obj("b", 30, 20))
        self.assertEqual(touching["classification"], "boundary-contact")
        self.assertEqual(touching["intersectionAreaM2"], 0)
        self.assertEqual(touching["boundaryContactLengthM"], 10)
        overlapping = self.measure(a, obj("b", 24, 20))
        self.assertEqual(overlapping["classification"], "positive-area-overlap")
        self.assertEqual(overlapping["intersectionAreaM2"], 60)

    def test_rotated_envelopes_can_warn_without_polygon_intersection(self):
        pair = self.measure(obj("a", 30, 30, 20, 2, 45), obj("b", 30, 36, 20, 2, 45))
        self.assertTrue(pair["wouldProduceEnvelopeWarning"])
        self.assertEqual(pair["classification"], "envelope-only")
        self.assertEqual(pair["intersectionAreaM2"], 0)
        self.assertGreater(pair["minimumGapM"], 2)


if __name__ == "__main__":
    unittest.main()
