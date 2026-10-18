import unittest

from speech.benchmark_metrics import audio_time, normalized_words, percentile, word_errors


class MetricsTests(unittest.TestCase):
    def test_case_punctuation_apostrophes_and_equivalent_numbers(self):
        self.assertEqual(word_errors("Don't drink twenty-five cans.", "DON’T drink 25 cans!")["word_errors"], 0)
        self.assertNotEqual(normalized_words("25"), normalized_words("13"))

    def test_insertions_deletions_substitutions_and_repeated_tail_count(self):
        self.assertEqual(word_errors("a b c", "a z c d")["word_errors"], 2)
        self.assertEqual(word_errors("a b c", "a c")["word_errors"], 1)
        self.assertEqual(word_errors("I don't know.", "I don't know. I don't know.")["word_error_rate_percent"], 100)
        self.assertEqual(word_errors("Red Bull drink", "bulletin")["word_errors"], 3)

    def test_empty_hypothesis_is_all_deletions(self):
        self.assertEqual(word_errors("hello there", "")["word_errors"], 2)
        with self.assertRaises(ValueError):
            word_errors("", "hello")

    def test_wire_timestamps_and_percentiles(self):
        self.assertEqual(audio_time("0:01:02.35"), 62.35)
        self.assertIsNone(audio_time("invalid"))
        self.assertEqual(percentile(list(range(1, 101)), 95), 95)
        self.assertIsNone(percentile([], 95))


if __name__ == "__main__":
    unittest.main()
