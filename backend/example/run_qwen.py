from llama_cpp import Llama
import sys

# Đường dẫn đến file model GGUF
model_path = "/Volumes/HatAI/Savecode/AI/Model/Qwen3-4B-Q4_K_M.gguf"

print(f"--- Đang tải mô hình từ: {model_path} ---")

try:
    # Khởi tạo mô hình
    # n_gpu_layers=-1: Sử dụng toàn bộ GPU (Metal trên Mac)
    # n_ctx: Kích thước context (ví dụ 4096)
    llm = Llama(
        model_path=model_path,
        n_gpu_layers=-1, # Tự động phát hiện và sử dụng Metal (Mac)
        n_ctx=4096,
        verbose=False
    )

    print("--- Mô hình đã sẵn sàng. Hãy nhập câu hỏi (Gõ 'exit' để thoát) ---")

    while True:
        user_input = input("\nBạn: ")
        if user_input.lower() in ["exit", "quit", "thoát"]:
            break

        print("\nQwen: ", end="", flush=True)

        # Chạy inference (stream=True để hiển thị từng từ)
        response = llm.create_chat_completion(
            messages=[
                {"role": "system", "content": "Bạn là một trợ lý AI thông minh và hữu ích."},
                {"role": "user", "content": user_input}
            ],
            stream=True,
            max_tokens=1024,
            temperature=0.7
        )

        for chunk in response:
            delta = chunk["choices"][0]["delta"]
            if "content" in delta:
                print(delta["content"], end="", flush=True)
        print()

except Exception as e:
    print(f"Lỗi: {e}")
    print("\nMẹo: Đảm bảo đã cài đặt llama-cpp-python đúng cách.")
    print("Cài đặt trên Mac (hỗ trợ Metal):")
    print("CMAKE_ARGS=\"-DGGML_METAL=on\" pip install llama-cpp-python --force-reinstall --upgrade --no-cache-dir")
