from decimal import Decimal

from taskharness.generate import generate_dataset, load_dataset
from taskharness.preprocess import clean
from taskharness.validate import validate_output


def test_generation_is_deterministic(tmp_path):
    generate_dataset(tmp_path / "a", count=5, seed=3)
    generate_dataset(tmp_path / "b", count=5, seed=3)
    a, b = load_dataset(tmp_path / "a"), load_dataset(tmp_path / "b")
    assert [d["text"] for d in a] == [d["text"] for d in b]
    assert [d["label"] for d in a] == [d["label"] for d in b]


def test_labels_are_internally_consistent(dataset):
    for doc in dataset:
        exp = doc["label"]["expected"]
        line_sum = sum(Decimal(str(i["amount"])) for i in exp["line_items"])
        assert line_sum == Decimal(str(exp["subtotal"]))
        total = Decimal(str(exp["subtotal"])) - Decimal(str(exp["discount"])) + Decimal(str(exp["tax"]))
        assert total == Decimal(str(exp["total"]))


def test_correct_answers_pass_every_check(dataset, template):
    """The validator must never flag a correct answer (no false alarms on gold labels)."""
    for doc in dataset:
        issues = validate_output(doc["label"]["expected"], clean(doc["text"]), template)
        assert issues == [], (doc["doc_id"], [i.message for i in issues])


def test_dataset_contains_the_traps(dataset):
    tricks = {t for doc in dataset for t in doc["label"]["meta"]["tricks"]}
    assert {"customer_first", "due_date_early", "discount", "previous_balance", "noise"} <= tricks
    assert {doc["label"]["meta"]["locale"] for doc in dataset} == {"IN", "US", "DE", "UK"}


def test_regenerating_fewer_documents_removes_old_ones(tmp_path):
    generate_dataset(tmp_path, count=5, seed=1)
    generate_dataset(tmp_path, count=2, seed=1)
    assert [d["doc_id"] for d in load_dataset(tmp_path)] == ["inv_001", "inv_002"]
