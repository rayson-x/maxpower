document.querySelectorAll(".quiz").forEach((quiz) => {
  const answer = quiz.dataset.answer;
  const explanation = quiz.dataset.explanation ?? "";
  const wrongExplanation =
    quiz.dataset.wrongExplanation ?? "先别看成功率，检查测试视频是否真正独立。";
  const feedback = quiz.querySelector(".feedback");

  quiz.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      const correct = input.value === answer;
      feedback.textContent = correct
        ? `✓ 正确。${explanation}`
        : `✗ ${wrongExplanation}`;
      feedback.className = `feedback ${correct ? "ok" : "bad"}`;
    });
  });
});
