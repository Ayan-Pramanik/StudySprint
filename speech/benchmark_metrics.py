"""Reference-based QA metrics; never used to rewrite a user's transcript."""

import math
import re


def number_words(number):
    ones = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
    tens = "zero ten twenty thirty forty fifty sixty seventy eighty ninety".split()
    if number < 20:
        return ones[number]
    if number < 100:
        return tens[number // 10] + (" " + ones[number % 10] if number % 10 else "")
    if number < 1000:
        return ones[number // 100] + " hundred" + (" " + number_words(number % 100) if number % 100 else "")
    if number < 10000:
        return ones[number // 1000] + " thousand" + (" " + number_words(number % 1000) if number % 1000 else "")
    return str(number)


def normalized_words(text):
    # Apply exactly the same normalization to both texts. Ignore case,
    # punctuation and numeric formatting, but keep genuine word/number errors.
    text = text.lower().replace("’", "'").replace("'", "")
    text = re.sub(r"\b\d{1,4}\b", lambda match: number_words(int(match[0])), text)
    return re.findall(r"[a-z0-9]+", text)


def word_errors(reference, hypothesis):
    expected, actual = normalized_words(reference), normalized_words(hypothesis)
    if not expected:
        raise ValueError("A nonempty reference transcript is required.")
    previous = list(range(len(actual) + 1))
    for row, word in enumerate(expected, 1):
        current = [row]
        for column, candidate in enumerate(actual, 1):
            current.append(min(current[-1] + 1, previous[column] + 1,
                               previous[column - 1] + (word != candidate)))
        previous = current
    return {"reference_words": len(expected), "word_errors": previous[-1],
            "word_error_rate_percent": round(100 * previous[-1] / len(expected), 2)}


def audio_time(value):
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            hours, minutes, seconds = map(float, value.split(":"))
            return hours * 3600 + minutes * 60 + seconds
        except ValueError:
            pass
    return None


def percentile(values, percent):
    return sorted(values)[max(0, math.ceil(len(values) * percent / 100) - 1)] if values else None
