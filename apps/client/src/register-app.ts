import "expo-router/entry";
import { getRandomValues } from "expo-crypto";
import { provideRandomValues } from "./random-values";

provideRandomValues(getRandomValues);
