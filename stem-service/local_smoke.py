"""Run separator on a local file (CPU) for parity checking."""
import sys
from separator import separate

if __name__ == "__main__":
    v, a = separate(sys.argv[1], "smoke_out", device="cpu")
    print("vocals:", v)
    print("accompaniment:", a)
